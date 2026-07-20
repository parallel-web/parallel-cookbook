"""Integration tests over the FastAPI app with the Parallel client mocked —
request validation, error mapping, and the CSV export contract."""

import backend.main as main
from backend import parallel_client as pc
from conftest import GATE_HEADERS


def _null_field():
    return {"value": None, "confidence": None, "citations": []}


def _brief(query="acme.ai"):
    field = {"value": "x", "confidence": "high", "citations": [{"url": "https://s.example", "excerpts": ["q"]}]}
    return {
        "query": query,
        "company_name": "Acme",
        "domain": "acme.ai",
        "firmographics": {k: dict(field) for k in ("industry", "hq", "employee_count", "founded_year", "description")},
        "funding": {k: dict(field) for k in ("total_raised", "last_round", "investors", "valuation", "revenue_estimate")},
        "technographics": {"tech_stack": {"value": ["Python"], "confidence": "high", "citations": [{"url": "https://s.example", "excerpts": []}]}},
        "buying_signals": {"value": [{"headline": "h", "type": "hiring", "date": "2026-07-01"}], "confidence": "high", "citations": []},
        "contacts": [{
            "name": dict(field), "title": dict(field), "seniority": dict(field),
            "linkedin_url": dict(field), "contact_methods": _null_field(),
            "inferred_email": {"value": "a.b@acme.ai", "confidence": "inferred", "citations": []},
        }],
        "meta": {"processor": "core-fast", "run_ids": ["r1"], "latency_ms": 10, "partial": False},
    }


def test_enrich_validates_empty_query(client):
    r = client.post("/api/enrich", json={"query": "   "}, headers=GATE_HEADERS)
    assert r.status_code == 422


def test_enrich_happy_path_returns_the_contract(client, monkeypatch):
    async def fake_enrich(query, depth, custom_fields=None):
        return _brief(query)

    monkeypatch.setattr(main.pc, "enrich", fake_enrich)
    r = client.post("/api/enrich", json={"query": "acme.ai"}, headers=GATE_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["company_name"] == "Acme"
    assert body["contacts"][0]["inferred_email"]["confidence"] == "inferred"


def test_parallel_errors_map_to_clean_http_statuses(client, monkeypatch):
    async def fake_enrich(query, depth, custom_fields=None):
        raise pc.ParallelCallError(403, "Out of balance.")

    monkeypatch.setattr(main.pc, "enrich", fake_enrich)
    r = client.post("/api/enrich", json={"query": "acme"}, headers=GATE_HEADERS)
    assert r.status_code == 403
    assert "balance" in r.json()["detail"].lower()


def test_bulk_unknown_job_is_a_friendly_404(client):
    r = client.get("/api/enrich/bulk/nonexistent", headers=GATE_HEADERS)
    assert r.status_code == 404
    assert "in-memory" in r.json()["detail"]


def test_bulk_status_preserves_job_id(client):
    job_id = "testjob123"
    main._BULK_JOBS[job_id] = {
        "status": "running", "done": 0, "total": 1,
        "results": [], "custom_defs": [],
    }
    try:
        r = client.get(f"/api/enrich/bulk/{job_id}", headers=GATE_HEADERS)
        assert r.status_code == 200
        assert r.json()["job_id"] == job_id
    finally:
        main._BULK_JOBS.pop(job_id, None)


def test_csv_export_flattens_the_brief(client):
    job_id = "testjob123"
    main._BULK_JOBS[job_id] = {
        "status": "done", "done": 1, "total": 1,
        "results": [_brief("acme.ai")], "custom_defs": [],
    }
    try:
        r = client.get(f"/api/enrich/bulk/{job_id}/export.csv", headers=GATE_HEADERS)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        header, row = r.text.strip().split("\n")[:2]
        assert "company_name" in header and "sources" in header
        assert "Acme" in row and "https://s.example" in row
    finally:
        main._BULK_JOBS.pop(job_id, None)


def test_signals_endpoint_serves_without_external_calls(client, monkeypatch):
    async def fake_list():
        return {"available": True, "mode": "verified", "signals": [], "monitors": []}

    monkeypatch.setattr(main.signals_service, "list_signals", fake_list)
    r = client.get("/api/signals", headers=GATE_HEADERS)
    assert r.status_code == 200
    assert r.json()["mode"] == "verified"


def test_weekly_digest_authorized_by_cron_bearer(client, monkeypatch):
    async def fake_digest():
        return {"ok": True, "signals": 0, "posted": 0, "mode": "disabled"}

    monkeypatch.setattr(main.signals_service, "run_weekly_digest", fake_digest)
    r = client.post(
        "/api/signals/weekly-digest",
        headers={"authorization": "Bearer test-cron-secret"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
