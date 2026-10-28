"""The UN General Debate endpoints, on fictional demo data."""
import csv
import io

import pytest


def test_summary_when_nothing_is_loaded(client):
    r = client.get("/api/un/summary")
    assert r.json()["loaded"] is False
    assert r.headers["cache-control"] == "no-store"


def test_summary(demo_client):
    r = demo_client.get("/api/un/summary")
    body = r.json()
    assert body["loaded"] and body["demo"]
    assert (body["first_year"], body["last_year"], body["statements"]) == (2000, 2025, 130)
    assert [c["name"] for c in body["countries"]] == ["Borduria", "Freedonia", "Orsinia", "Syldavia", "Valdoria"]
    assert "NATO" in body["keywords"] and "sanction*" in body["keywords"]
    assert "s-maxage" in r.headers["cache-control"]


def test_series_with_average(demo_client):
    body = demo_client.get("/api/un/series", params={"countries": "VLD,ORS", "metric": "hostility",
                                                     "start": 2010, "end": 2020}).json()
    assert [s["country"] for s in body["series"]] == ["VLD", "ORS"]
    assert [p["year"] for p in body["series"][0]["points"]] == list(range(2010, 2021))
    assert all(p["value"] > 0 for p in body["series"][0]["points"])
    assert len(body["average"]) == 11
    one_year = [p["value"] for s in demo_client.get("/api/un/series", params={
        "countries": "VLD,ORS,FRD,SYL,BOR", "metric": "hostility", "start": 2015, "end": 2015,
        "average": False}).json()["series"] for p in s["points"]]
    avg_2015 = next(p["value"] for p in body["average"] if p["year"] == 2015)
    assert avg_2015 == pytest.approx(sum(one_year) / len(one_year))


def test_series_for_a_keyword(demo_client):
    body = demo_client.get("/api/un/series", params={"countries": "VLD", "metric": "kw::sovereign*"}).json()
    assert len(body["series"][0]["points"]) == 26
    assert body["average"] and all(p["value"] is not None for p in body["average"])


@pytest.mark.parametrize("params, message", [
    ({"countries": "A,B,C,D,E,F,G,H,I"}, "at most 8"),
    ({"countries": "VLD", "metric": "volume"}, "Unknown metric"),
    ({"countries": "VLD", "start": 2020, "end": 2000}, "start year"),
])
def test_series_rejects_bad_requests(demo_client, params, message):
    r = demo_client.get("/api/un/series", params=params)
    assert r.status_code == 422 and message in r.json()["detail"]


def test_matrix(demo_client):
    body = demo_client.get("/api/un/matrix", params={"metric": "hostility"}).json()
    assert body["years"] == list(range(2000, 2026))
    assert [c["code"] for c in body["countries"]] == ["BOR", "FRD", "ORS", "SYL", "VLD"]
    vld = body["values"]["VLD"]
    assert len(vld) == 26 and all(v > 0 for v in vld)
    series = demo_client.get("/api/un/series", params={"countries": "VLD", "metric": "hostility",
                                                       "average": False}).json()["series"][0]["points"]
    assert vld[14] == pytest.approx(series[14]["value"], abs=1e-4)          # 2014


def test_matrix_for_keywords(demo_client):
    body = demo_client.get("/api/un/matrix", params={"metric": "kw::NATO"}).json()
    assert len(body["values"]) == 5
    assert demo_client.get("/api/un/matrix", params={"metric": "nope"}).status_code == 422


def test_matrix_without_data(client):
    assert client.get("/api/un/matrix").json() == {"metric": "tone_balance", "years": [], "countries": [],
                                                   "values": {}}


def test_shifts(demo_client):
    body = demo_client.get("/api/un/shifts", params={"countries": "ORS,SYL", "metric": "tone_balance", "n": 3}).json()
    assert len(body) == 3
    assert abs(body[0]["change"]) >= abs(body[1]["change"]) >= abs(body[2]["change"])
    assert body[0]["year"] > body[0]["from_year"] and body[0]["name"] in {"Orsinia", "Syldavia"}


def test_statement(demo_client):
    body = demo_client.get("/api/un/statements/vld/2014").json()
    assert body["name"] == "Valdoria" and body["session"] == 69
    assert body["counts"]["sentences"] == 24
    assert {s["kind"] for s in body["sentences"]} <= {"hostile", "negative", "cooperative"}
    hostile = [s for s in body["sentences"] if s["kind"] == "hostile"]
    assert hostile and hostile[0]["highlights"]
    assert body["keywords"]["NATO"] == 0


def test_missing_statement(demo_client):
    r = demo_client.get("/api/un/statements/VLD/1950")
    assert r.status_code == 404


def test_statement_text(demo_client):
    body = demo_client.get("/api/un/statements/vld/2014/text").json()
    assert body["country"] == "VLD" and body["year"] == 2014
    assert len(body["reading"]) == 4                         # the demo speeches have four paragraphs
    sentences = [s for p in body["reading"] for s in p]
    assert [s["index"] for s in sentences] == list(range(24))
    notable = demo_client.get("/api/un/statements/vld/2014").json()["sentences"]
    for s in notable:                                        # positions point at the same sentences
        assert sentences[s["position"]]["text"] == s["sentence"]
    assert any(s["highlights"] for s in sentences)
    assert demo_client.get("/api/un/statements/VLD/1950/text").status_code == 404


def test_ranking(demo_client):
    body = demo_client.get("/api/un/ranking", params={"year": 2020, "metric": "hostility"}).json()
    values = [row["value"] for row in body["rows"]]
    assert len(values) == 5 and values == sorted(values, reverse=True)
    assert [row["rank"] for row in body["rows"]] == [1, 2, 3, 4, 5]


def test_export_csv(demo_client):
    r = demo_client.get("/api/un/export.csv", params={"countries": "VLD", "start": 2020})
    assert r.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(r.text.lstrip("\ufeff"))))
    assert len(rows) == 6 and rows[0]["country_name"] == "Valdoria"
    assert "kw::NATO" in rows[0] and rows[0]["tone_balance"]


def test_export_all_countries(demo_client):
    r = demo_client.get("/api/un/export.csv")
    assert len(r.text.strip().splitlines()) == 131
