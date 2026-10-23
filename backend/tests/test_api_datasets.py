"""User datasets: create, upload in batches, aggregate, rescore, export, delete."""
import csv
import io

import pytest

from dla import config

HOSTILE = "We condemn the illegal sanctions and the aggression against our people."
COOP = "We welcome dialogue and cooperation with all our partners in the region."


def create(client, **body):
    r = client.post("/api/datasets", json={"name": "State media 2023", **body})
    assert r.status_code == 201, r.text
    return r.json()["dataset"]["id"], {"X-Edit-Token": r.json()["edit_token"]}


def add(client, dataset_id, headers, documents):
    return client.post(f"/api/datasets/{dataset_id}/documents", json={"documents": documents}, headers=headers)


def test_create_and_read(client):
    dataset_id, _ = create(client, keywords=["sanction*", "NATO", "sanction*"])
    body = client.get(f"/api/datasets/{dataset_id}").json()
    assert body["name"] == "State media 2023" and body["documents"] == 0
    assert body["keywords"] == ["sanction*", "NATO"] and body["uses_default_dictionaries"]


def test_unknown_dataset(client):
    assert client.get("/api/datasets/does-not-exist").status_code == 404


def test_add_documents_validates_each_row(client):
    dataset_id, headers = create(client)
    r = add(client, dataset_id, headers, [
        {"country": "vnm", "year": 2023, "text": HOSTILE, "source": "News agency"},
        {"country": "VNM", "year": 2023, "text": COOP},
        {"country": "C1!", "year": 2023, "text": COOP},
        {"country": "CHN", "year": 1066, "text": COOP},
        {"country": "CHN", "year": 2024, "text": "Too short."},
        {"country": "CHN", "year": 2024, "text": "   "},
    ])
    body = r.json()
    assert body["added"] == 2 and body["total_documents"] == 2
    assert [p["row"] for p in body["skipped"]] == [2, 3, 4, 5]
    assert "country code" in body["skipped"][0]["reason"]


def test_writes_need_the_edit_token(client):
    dataset_id, _ = create(client)
    doc = [{"country": "VNM", "year": 2023, "text": COOP}]
    assert add(client, dataset_id, {}, doc).status_code == 403
    assert add(client, dataset_id, {"X-Edit-Token": "wrong"}, doc).status_code == 403
    assert client.delete(f"/api/datasets/{dataset_id}").status_code == 403


def test_batch_size_is_capped(client):
    dataset_id, headers = create(client)
    docs = [{"country": "VNM", "year": 2023, "text": COOP}] * (config.MAX_BATCH_DOCUMENTS + 1)
    assert add(client, dataset_id, headers, docs).status_code == 422


def test_dataset_size_is_capped(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_DATASET_DOCUMENTS", 2)
    dataset_id, headers = create(client)
    assert add(client, dataset_id, headers, [{"country": "VNM", "year": 2023, "text": COOP}] * 2).status_code == 200
    r = add(client, dataset_id, headers, [{"country": "VNM", "year": 2023, "text": COOP}])
    assert r.status_code == 413 and "at most 2" in r.json()["detail"]


def test_yearly_sums_counts_before_dividing(client):
    dataset_id, headers = create(client, keywords=["sanction*"])
    add(client, dataset_id, headers, [
        {"country": "VNM", "year": 2023, "text": HOSTILE},
        {"country": "VNM", "year": 2023, "text": COOP + " " + COOP},
        {"country": "CHN", "year": 2024, "text": COOP},
    ])
    body = client.get(f"/api/datasets/{dataset_id}/yearly").json()
    rows = {(r["country"], r["year"]): r for r in body["rows"]}
    vnm = rows[("VNM", 2023)]
    assert vnm["documents"] == 2 and vnm["name"] == "Vietnam"
    assert vnm["hostile_hits"] == 4 and vnm["coop_hits"] == 8
    assert vnm["tone_balance"] == pytest.approx((8 - 4) / 12)
    assert vnm["kw::sanction*"] == pytest.approx(1 / vnm["words"] * 1000)
    info = client.get(f"/api/datasets/{dataset_id}").json()
    assert info["countries"] == ["CHN", "VNM"] and (info["first_year"], info["last_year"]) == (2023, 2024)


def test_list_and_delete_documents(client):
    dataset_id, headers = create(client)
    add(client, dataset_id, headers, [{"country": "VNM", "year": 2023, "text": HOSTILE},
                                      {"country": "VNM", "year": 2024, "text": COOP}])
    page = client.get(f"/api/datasets/{dataset_id}/documents", params={"limit": 1}).json()
    assert page["total"] == 2 and len(page["items"]) == 1
    assert page["items"][0]["metrics"]["hostility"] > 0
    doc_id = page["items"][0]["id"]
    assert client.delete(f"/api/datasets/{dataset_id}/documents/{doc_id}", headers=headers).status_code == 204
    assert client.delete(f"/api/datasets/{dataset_id}/documents/{doc_id}", headers=headers).status_code == 404
    assert client.get(f"/api/datasets/{dataset_id}").json()["documents"] == 1


def test_rescore_with_new_dictionaries_and_keywords(client, monkeypatch):
    monkeypatch.setattr(config, "RESCORE_BATCH", 2)
    dataset_id, headers = create(client)
    add(client, dataset_id, headers, [{"country": "VNM", "year": 2020 + i, "text": HOSTILE} for i in range(3)])
    r = client.post(f"/api/datasets/{dataset_id}/rescore", headers=headers,
                    json={"hostile_terms": ["sanction*"], "keywords": ["people"]})
    assert r.json() == {"rescored": 2, "remaining": 1}
    assert client.get(f"/api/datasets/{dataset_id}").json()["stale_documents"] == 1
    assert client.post(f"/api/datasets/{dataset_id}/rescore", headers=headers).json() == {
        "rescored": 1, "remaining": 0}
    info = client.get(f"/api/datasets/{dataset_id}").json()
    assert info["hostile_terms"] == ["sanction*"] and not info["uses_default_dictionaries"]
    rows = client.get(f"/api/datasets/{dataset_id}/yearly").json()["rows"]
    assert all(r["hostile_hits"] == 1 and r["kw::people"] > 0 for r in rows)


def test_export_csv(client):
    dataset_id, headers = create(client, keywords=["NATO"])
    add(client, dataset_id, headers, [
        {"country": "VNM", "year": 2023, "text": HOSTILE, "title": "=HYPERLINK(\"http://x\")"}])
    yearly = list(csv.DictReader(io.StringIO(
        client.get(f"/api/datasets/{dataset_id}/export.csv").text.lstrip("\ufeff"))))
    assert yearly[0]["country_name"] == "Vietnam" and yearly[0]["kw::NATO"] == "0.0"
    docs = list(csv.DictReader(io.StringIO(client.get(
        f"/api/datasets/{dataset_id}/export.csv", params={"level": "documents"}).text.lstrip("\ufeff"))))
    assert docs[0]["text"] == HOSTILE
    assert docs[0]["title"].startswith("'=")           # spreadsheet formulas are neutralised


def test_delete_dataset(client):
    dataset_id, headers = create(client)
    add(client, dataset_id, headers, [{"country": "VNM", "year": 2023, "text": COOP}])
    assert client.delete(f"/api/datasets/{dataset_id}", headers=headers).status_code == 204
    assert client.get(f"/api/datasets/{dataset_id}").status_code == 404


def test_custom_dictionaries_at_creation(client):
    dataset_id, headers = create(client, hostile_terms=["sanction*"], coop_terms=["dialogue"])
    add(client, dataset_id, headers, [{"country": "VNM", "year": 2023, "text": HOSTILE + " " + COOP}])
    row = client.get(f"/api/datasets/{dataset_id}/yearly").json()["rows"][0]
    assert (row["hostile_hits"], row["coop_hits"]) == (1, 1)


def test_name_is_required(client):
    assert client.post("/api/datasets", json={"name": ""}).status_code == 422
