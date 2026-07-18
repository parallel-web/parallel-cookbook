"""The access gate: server-side enforcement and explicit exemptions."""

import base64
import hashlib
import hmac
import json
import time

import backend.main as main
import parallel
import pytest
from conftest import GATE_HEADERS, WEBHOOK_SECRET


def _sign_webhook(body: bytes, wid: str = "whevent_test") -> dict[str, str]:
    """Build valid Standard Webhooks headers for the test secret."""
    key = base64.b64decode(WEBHOOK_SECRET[len("whsec_"):])
    ts = str(int(time.time()))
    mac = hmac.new(key, f"{wid}.{ts}.".encode() + body, hashlib.sha256).digest()
    return {
        "webhook-id": wid,
        "webhook-timestamp": ts,
        "webhook-signature": "v1," + base64.b64encode(mac).decode(),
        "content-type": "application/json",
    }


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


def test_key_rejected_in_query_params(client):
    r = client.get("/api/auth/check?key=test-passphrase")
    assert r.status_code == 401


def test_monitor_webhook_exempt_from_demo_gate_but_verifies_signature(client):
    # No demo header needed, but a valid Standard Webhooks signature is required.
    # Missing signature headers -> rejected.
    r = client.post("/api/monitor/webhook", json={"type": "other"})
    assert r.status_code == 401

    # A tampered/invalid signature -> rejected.
    body = b'{"type":"other"}'
    bad = _sign_webhook(body) | {"webhook-signature": "v1,not-the-real-signature"}
    assert client.post("/api/monitor/webhook", content=body, headers=bad).status_code == 401

    # A correctly signed request is accepted (this event type is ignored -> 200).
    r = client.post("/api/monitor/webhook", content=body, headers=_sign_webhook(body))
    assert r.status_code == 200
    assert r.json()["ignored"] is True


def test_failed_webhook_processing_can_be_retried(client, monkeypatch):
    webhook_id = "whevent_retry"
    body = json.dumps({
        "type": "monitor.event.detected",
        "data": {
            "monitor_id": "monitor_1",
            "event": {"event_group_id": "group_1"},
            "metadata": {"fund": "Example Ventures"},
        },
    }).encode()
    headers = _sign_webhook(body, webhook_id)

    class FailingMonitor:
        async def events(self, *_args, **_kwargs):
            raise RuntimeError("temporary Parallel failure")

    class FailingClient:
        def __init__(self, **_kwargs):
            self.monitor = FailingMonitor()

        async def close(self):
            pass

    monkeypatch.setattr(parallel, "AsyncParallel", FailingClient)
    with pytest.raises(RuntimeError, match="temporary Parallel failure"):
        client.post("/api/monitor/webhook", content=body, headers=headers)
    assert webhook_id not in main._SEEN_WEBHOOK_IDS

    class SuccessfulMonitor:
        async def events(self, *_args, **_kwargs):
            return type("Result", (), {"events": []})()

    class SuccessfulClient:
        def __init__(self, **_kwargs):
            self.monitor = SuccessfulMonitor()

        async def close(self):
            pass

    monkeypatch.setattr(parallel, "AsyncParallel", SuccessfulClient)
    try:
        retry = client.post("/api/monitor/webhook", content=body, headers=headers)
        assert retry.status_code == 200
        assert retry.json() == {"ok": True, "posted": 0}
    finally:
        main._SEEN_WEBHOOK_IDS.pop(webhook_id, None)


def test_weekly_digest_requires_cron_or_manual_secret(client):
    assert client.post("/api/signals/weekly-digest").status_code == 401
    assert (
        client.post(
            "/api/signals/weekly-digest",
            headers={"authorization": "Bearer nope"},
        ).status_code
        == 401
    )
