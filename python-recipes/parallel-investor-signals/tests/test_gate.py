"""The access gate: server-side enforcement, exemptions, and query-param path."""

from conftest import GATE_HEADERS


def test_api_routes_reject_without_key(client):
    r = client.post("/api/enrich", json={"query": "acme"})
    assert r.status_code == 401
    assert "passphrase" in r.json()["detail"].lower()


def test_wrong_key_rejected(client):
    r = client.get("/api/auth/check", headers={"x-demo-key": "wrong"})
    assert r.status_code == 401


def test_correct_key_unlocks(client):
    r = client.get("/api/auth/check", headers=GATE_HEADERS)
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_health_is_exempt_and_never_leaks_the_key(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["key_loaded"] is True
    assert "test-parallel-key" not in r.text


def test_key_accepted_via_query_param_for_downloads(client):
    # The CSV export link is a plain <a>, which can't send headers.
    r = client.get("/api/auth/check?key=test-passphrase")
    assert r.status_code == 200


def test_monitor_webhook_exempt_from_demo_gate_but_has_own_secret(client):
    # no demo header needed, but the webhook secret is enforced
    r = client.post("/api/monitor/webhook", json={"type": "other"})
    assert r.status_code == 401  # missing ?key=WEBHOOK_SECRET
    r = client.post(
        "/api/monitor/webhook?key=test-webhook-secret", json={"type": "other"}
    )
    assert r.status_code == 200
    assert r.json()["ignored"] is True


def test_weekly_digest_requires_cron_or_manual_secret(client):
    assert client.post("/api/signals/weekly-digest").status_code == 401
    assert (
        client.post(
            "/api/signals/weekly-digest",
            headers={"authorization": "Bearer nope"},
        ).status_code
        == 401
    )
