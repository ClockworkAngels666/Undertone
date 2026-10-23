"""Health check, metadata, docs and error responses."""


def test_health_ok_without_un_data(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok" and r.json()["database"] == "ok" and r.json()["un_data"] is None


def test_health_reports_loaded_data(demo_client):
    body = demo_client.get("/api/health").json()
    assert body["un_data"]["source"] == "demo"
    assert body["un_data"]["statements"] == 5 * 26


def test_health_when_database_is_down(client, broken_database):
    r = client.get("/api/health")
    assert r.status_code == 503
    assert r.json()["database"] == "unavailable"


def test_endpoints_return_503_when_database_is_down(client, broken_database):
    r = client.get("/api/un/summary")
    assert r.status_code == 503
    assert "database is unavailable" in r.json()["detail"]


def test_meta(client):
    body = client.get("/api/meta").json()
    assert [m["id"] for m in body["metrics"]] == ["tone_balance", "hostility", "cooperation", "vader_mean",
                                                 "negative_share"]
    assert "sanction*" in body["default_dictionaries"]["hostile"]
    assert body["context_model"]["available"] is False
    assert "Jankin" in body["citation"]
    assert {"year": 2022, "label": "Russia–Ukraine"} in body["events"]


def test_unknown_api_route_is_json_404(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and r.json()["detail"].startswith("No API endpoint")


def test_api_docs_are_served(client):
    assert client.get("/api/docs").status_code == 200
    schema = client.get("/api/openapi.json").json()
    assert "/api/analyze" in schema["paths"] and "/api/datasets" in schema["paths"]


def test_validation_errors_are_readable(client):
    r = client.post("/api/analyze", json={})
    assert r.status_code == 422
    assert r.json()["detail"].startswith("text:")
