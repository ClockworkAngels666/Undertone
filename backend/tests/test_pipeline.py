"""The UN corpus pipeline: reading the archive, scoring, loading (twice), downloading."""
import io
import tarfile

import pytest
from sqlalchemy import func, select

from dla import db, pipeline
from dla.models import Country, PipelineRun, UNCountryYear, UNKeywordRate, UNSentence, UNText

SPEECHES = {
    "TXT/Session 77 - 2022/RUS_77_2022.txt": "We condemn the sanctions and NATO expansion. We welcome dialogue.",
    "TXT/Session 77 - 2022/USA_77_2022.txt": "We stand together with our partners in solidarity and trust.",
    "TXT/Session 78 - 2023/RUS_78_2023.txt": "The aggression of the bloc is a threat to every sovereign nation.",
    "TXT/Session 78 - 2023/._RUS_78_2023.txt": "\x00\x05\x16\x07 macOS metadata, not a speech",
    "TXT/.DS_Store": "junk",
}


@pytest.fixture
def archive(tmp_path):
    path = tmp_path / "UNGDC_test.tar.gz"
    with tarfile.open(path, "w:gz") as tar:
        for name, text in SPEECHES.items():
            data = text.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return path


@pytest.fixture
def no_network(monkeypatch):
    def offline(*_args, **_kwargs):
        raise pipeline.requests.ConnectionError("offline in tests")

    monkeypatch.setattr(pipeline.requests, "get", offline)


def test_iter_statements_skips_junk(archive):
    found = sorted((c, s, y) for c, s, y, _ in pipeline.iter_statements(archive))
    assert found == [("RUS", 77, 2022), ("RUS", 78, 2023), ("USA", 77, 2022)]


def test_run_loads_everything_and_is_safe_to_repeat(client, archive, tmp_path, monkeypatch, no_network):
    monkeypatch.setattr(pipeline, "CACHE_DIR", tmp_path / "cache")
    for attempt in range(2):
        with db.new_session() as session:
            summary = pipeline.run(session, archive, workers=1)
        assert summary["statements"] == 3 and summary["countries"] == 2
        with db.new_session() as session:
            count = lambda model: session.scalar(select(func.count()).select_from(model))  # noqa: E731
            assert count(UNCountryYear) == 3 and count(Country) == 2
            assert count(UNKeywordRate) == 3 * len(pipeline.analysis.DEFAULT_KEYWORDS)
            assert count(UNSentence) > 0
            assert count(PipelineRun) == attempt + 1
            rus = session.scalars(select(UNCountryYear).where(UNCountryYear.country_code == "RUS",
                                                              UNCountryYear.year == 2022)).one()
            assert rus.session == 77 and rus.hostile_hits == 2 and rus.coop_hits == 2
            nato = session.get(UNKeywordRate, (rus.id, "NATO"))
            assert nato.hits == 1 and nato.per_1000 == pytest.approx(1000 / rus.words)
            assert count(UNText) == 3
    assert len(list((tmp_path / "cache").glob("*.json.gz"))) == 1     # the second run used the cache
    body = client.get("/api/un/summary").json()
    assert body["loaded"] and not body["demo"] and body["countries"][0]["name"] == "Russia"
    reading = client.get("/api/un/statements/RUS/2022/text").json()["reading"]
    assert [s["text"] for p in reading for s in p] == ["We condemn the sanctions and NATO expansion.",
                                                       "We welcome dialogue."]


def test_texts_join_a_years_documents_in_session_order():
    texts = pipeline.statement_texts([("FRA", 2, 1947, "Second."), ("FRA", 1, 1947, "First."),
                                      ("GBR", 2, 1947, "Other.")])
    assert texts == {("FRA", 1947): "First.\n\nSecond.", ("GBR", 1947): "Other."}


def test_load_un_texts_only_replaces_the_texts(client, archive, no_network):
    with db.new_session() as session:
        stored = pipeline.run_texts(session, archive)
    assert stored["texts"] == 3
    with db.new_session() as session:
        assert session.scalar(select(func.count()).select_from(UNText)) == 3
        assert session.scalar(select(func.count()).select_from(UNCountryYear)) == 0


def test_parallel_scoring_matches_serial(archive):
    serial = pipeline.score_corpus(archive, workers=1)
    parallel = pipeline.score_corpus(archive, workers=2)
    assert serial == parallel


def test_checksum_mismatch_is_an_error(archive, monkeypatch):
    monkeypatch.setattr(pipeline, "dataverse_archive_info",
                        lambda timeout=60: {"filename": archive.name, "md5": "0" * 32, "version": "1.0"})
    with pytest.raises(pipeline.PipelineError, match="corrupt"):
        pipeline.verify(archive)


class FakeResponse:
    def __init__(self, status, text="", payload=None):
        self.status_code, self.text, self._payload = status, text, payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise pipeline.requests.HTTPError(str(self.status_code))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_download_explains_the_guestbook(tmp_path, monkeypatch):
    metadata = {"data": {"latestVersion": {"versionNumber": 14, "versionMinorNumber": 0, "files": [
        {"dataFile": {"id": 1, "filename": "UNGDC_1946-2025.tar.gz", "filesize": 71280312,
                      "checksum": {"type": "MD5", "value": "abc"}}}]}}}

    def fake_get(url, **_kwargs):
        if "datasets" in url:
            return FakeResponse(200, payload=metadata)
        return FakeResponse(400, text='{"message":"You may not download this file without the required Guestbook"}')

    monkeypatch.setattr(pipeline.requests, "get", fake_get)
    with pytest.raises(pipeline.PipelineError, match="guestbook"):
        pipeline.download(tmp_path)
    assert not list(tmp_path.iterdir())


def test_cli_refuses_to_replace_real_data_with_demo(client, archive, tmp_path, monkeypatch, no_network):
    from dla.__main__ import main

    monkeypatch.setattr(pipeline, "CACHE_DIR", tmp_path / "cache")
    with db.new_session() as session:
        pipeline.run(session, archive, workers=1)
    assert main(["seed-demo"]) == 1
    assert main(["seed-demo", "--force"]) == 0
