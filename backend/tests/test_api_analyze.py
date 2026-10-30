"""POST /api/analyze and POST /api/extract-text."""
import pytest

from dla import config

SAMPLE = (
    "Our nation remains committed to multilateralism, dialogue and mutual respect among all States. "
    "The unilateral sanctions imposed on our people are illegal and violate the Charter. "
    "We condemn these double standards. Let us build bridges and work together for a peaceful future."
)


def test_analyze_sample(client):
    r = client.post("/api/analyze", json={"text": SAMPLE})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"]["sentences"] == 4
    assert body["counts"]["hostile_hits"] >= 4 and body["counts"]["coop_hits"] >= 5
    assert -1 <= body["metrics"]["tone_balance"] <= 1
    assert body["default_dictionaries"] is True
    assert body["baseline"] is None                      # no UN data loaded in this test
    kinds = {kind for _, _, kind in body["highlights"]}
    assert kinds == {"hostile", "cooperative"}
    start, end, _ = body["highlights"][0]
    assert SAMPLE[start:end].lower() in {"multilateralism", "dialogue"}
    assert body["top_terms"]["hostile"][0][1] >= 1
    assert body["sentences"][1]["hostile_hits"] >= 2
    assert body["context_model"] == {"available": False, "used": False, "name": None}


def test_analyze_compares_with_un_baseline(demo_client):
    body = demo_client.post("/api/analyze", json={"text": SAMPLE}).json()
    base = body["baseline"]
    assert (base["first_year"], base["last_year"]) == (2016, 2025)
    assert base["statements"] == 5 * 10
    assert 0 <= base["hostility_share_below"] <= 1
    assert 0 <= base["cooperation_share_below"] <= 1
    assert base["median_words"] > 0
    # a short text: the comparison comes with a short-text caution that names the typical length
    assert any("short text (" in w and "median" in w for w in body["warnings"])
    assert set(base["averages"]) == {"tone_balance", "hostility", "cooperation", "vader_mean", "negative_share"}


def test_custom_dictionaries_skip_the_baseline(demo_client):
    body = demo_client.post("/api/analyze", json={"text": SAMPLE, "hostile_terms": ["sanction*"],
                                                  "coop_terms": ["dialogue"]}).json()
    assert body["counts"]["hostile_hits"] == 1 and body["counts"]["coop_hits"] == 1
    assert body["default_dictionaries"] is False and body["baseline"] is None
    assert any("Custom dictionaries" in w for w in body["warnings"])


def test_analysis_works_while_database_is_down(client, broken_database):
    body = client.post("/api/analyze", json={"text": SAMPLE}).json()
    assert body["counts"]["sentences"] == 4 and body["baseline"] is None
    assert any("database offline" in w for w in body["warnings"])


def test_context_model_request_is_declined_when_off(client):
    body = client.post("/api/analyze", json={"text": SAMPLE, "context_model": True}).json()
    assert body["context_model"]["used"] is False
    assert any("context model" in w for w in body["warnings"])


@pytest.mark.parametrize("text, message", [
    ("   ", "empty"),
    ("Thank you.", "too short"),
])
def test_bad_texts(client, text, message):
    r = client.post("/api/analyze", json={"text": text})
    assert r.status_code == 422 and message in r.json()["detail"]


def test_text_too_long(client):
    r = client.post("/api/analyze", json={"text": "word " * (config.MAX_TEXT_CHARS // 5 + 1)})
    assert r.status_code == 422


def test_dictionary_too_long(client):
    r = client.post("/api/analyze", json={"text": SAMPLE, "hostile_terms": [f"t{i}" for i in range(501)]})
    assert r.status_code == 422 and "maximum is 500" in r.json()["detail"]


def make_pdf(text):
    """A minimal one-page PDF with a text layer."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def test_extract_text_from_txt(client):
    r = client.post("/api/extract-text", files={"file": ("speech.txt", "We welcome dialogue today.".encode("utf-16"))})
    assert r.status_code == 200
    assert r.json()["text"] == "We welcome dialogue today." and r.json()["pages"] is None


def test_extract_text_from_cp1252_txt(client):
    r = client.post("/api/extract-text", files={"file": ("a.txt", "Café talks “begin” today.".encode("cp1252"))})
    assert r.json()["text"] == "Café talks “begin” today."


def test_extract_text_from_pdf(client):
    r = client.post("/api/extract-text", files={"file": ("speech.pdf", make_pdf("We condemn the aggression."))})
    assert r.status_code == 200, r.text
    assert "We condemn the aggression." in r.json()["text"] and r.json()["pages"] == 1


@pytest.mark.parametrize("name, data, status, message", [
    ("speech.docx", b"PK\x03\x04", 422, "Only .txt and .pdf"),
    ("empty.txt", b"", 422, "empty"),
    ("broken.pdf", b"not a pdf at all", 422, "not a readable PDF"),
    ("blank.txt", b"   \n  ", 422, "No text found"),
])
def test_extract_text_rejects_bad_files(client, name, data, status, message):
    r = client.post("/api/extract-text", files={"file": (name, data)})
    assert r.status_code == status and message in r.json()["detail"]


def test_extract_text_rejects_large_files(client):
    r = client.post("/api/extract-text", files={"file": ("big.txt", b"a" * (config.MAX_UPLOAD_BYTES + 1))})
    assert r.status_code == 413
