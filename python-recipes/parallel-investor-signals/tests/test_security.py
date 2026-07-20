"""Security/correctness regressions for the fixes in the review round:
webhook signature verification, CSV formula-injection, the domain credibility
gate, and the shared signal qualification."""

import base64
import hashlib
import hmac

import pytest
from backend import investor_core as core
from backend import parallel_client as pc
from backend import webhook_verify
from backend.main import _csv_safe

_SECRET = "whsec_" + base64.b64encode(b"a-32-byte-test-signing-key-0001!!").decode()


def _sign(secret: str, wid: str, ts: str, body: bytes) -> str:
    key = base64.b64decode(secret[len("whsec_"):])
    mac = hmac.new(key, f"{wid}.{ts}.".encode() + body, hashlib.sha256).digest()
    return "v1," + base64.b64encode(mac).decode()


# ------------------------------------------------------------- webhook verify --
def test_webhook_valid_signature_passes():
    body = b'{"type":"monitor.event.detected"}'
    now, wid, ts = 1_700_000_000, "whevent_1", "1700000000"
    headers = {
        "webhook-id": wid,
        "webhook-timestamp": ts,
        "webhook-signature": _sign(_SECRET, wid, ts, body),
    }
    webhook_verify.verify(body, headers, _SECRET, now=now)  # must not raise


def test_webhook_bad_signature_fails():
    body = b'{"a":1}'
    now, wid, ts = 1_700_000_000, "whevent_1", "1700000000"
    headers = {"webhook-id": wid, "webhook-timestamp": ts, "webhook-signature": "v1,not-a-real-sig"}
    with pytest.raises(webhook_verify.WebhookVerificationError):
        webhook_verify.verify(body, headers, _SECRET, now=now)


def test_webhook_tampered_body_fails():
    now, wid, ts = 1_700_000_000, "whevent_1", "1700000000"
    sig = _sign(_SECRET, wid, ts, b'{"amount":"$1M"}')
    headers = {"webhook-id": wid, "webhook-timestamp": ts, "webhook-signature": sig}
    with pytest.raises(webhook_verify.WebhookVerificationError):
        webhook_verify.verify(b'{"amount":"$99M"}', headers, _SECRET, now=now)


def test_webhook_stale_timestamp_fails():
    body = b"{}"
    wid, ts = "whevent_1", "1700000000"
    headers = {"webhook-id": wid, "webhook-timestamp": ts, "webhook-signature": _sign(_SECRET, wid, ts, body)}
    with pytest.raises(webhook_verify.WebhookVerificationError):
        webhook_verify.verify(body, headers, _SECRET, now=1_700_000_000 + 10_000)


def test_webhook_missing_headers_or_secret_fail():
    with pytest.raises(webhook_verify.WebhookVerificationError):
        webhook_verify.verify(b"{}", {}, _SECRET, now=1_700_000_000)
    with pytest.raises(webhook_verify.WebhookVerificationError):
        webhook_verify.verify(b"{}", {"webhook-id": "x"}, "", now=1_700_000_000)


# ------------------------------------------------------------- csv injection --
@pytest.mark.parametrize("dangerous", ["=1+1", "+1", "-1", "@SUM(A1)", "\ttab", "=cmd|' /C calc'!A0"])
def test_csv_formula_cells_are_neutralized(dangerous):
    assert _csv_safe(dangerous).startswith("'")


def test_csv_safe_leaves_normal_text():
    assert _csv_safe("Ramp") == "Ramp"
    assert _csv_safe("") == ""
    assert _csv_safe("Series B: $50M") == "Series B: $50M"


# ------------------------------------------------------------ domain gating ---
def test_user_supplied_domain_is_trusted():
    assert pc._looks_like_domain("ramp.com")
    assert pc._looks_like_domain("https://ramp.com/pricing")
    assert not pc._looks_like_domain("Ramp")
    assert not pc._looks_like_domain("Acme Inc.")


def test_uncited_model_domain_is_dropped():
    meta = {"processor": "", "run_ids": [], "latency_ms": 0}
    # Query is a NAME and the model's domain carries no citation -> dropped.
    brief = pc.to_research_brief("Acme", {"content": {"company_name": "Acme", "domain": "acme.com"}, "basis": []}, None, meta)
    assert brief["domain"] is None
    # Query IS a domain -> trusted (user input, not model output).
    brief2 = pc.to_research_brief("acme.com", {"content": {"company_name": "Acme", "domain": "acme.com"}, "basis": []}, None, meta)
    assert brief2["domain"] == "acme.com"


# --------------------------------------------------------- signal qualification
def test_qualify_signal_uses_crm_over_local_list():
    portfolio = {core.norm_company("Acme Robotics"): {"name": "Acme Robotics"}}
    r = {"company": "Acme Robotics", "round_stage": "Seed", "amount_usd_millions": 10, "parallel_fit_rating": 7}

    # No CRM configured -> falls back to the local known list.
    s = core.qualify_signal(r, "Accel", portfolio, {"event_id": "e1"}, None)
    assert s["known_portco"] is True
    assert s["fund_watched"] == "Accel" and s["event_id"] == "e1"
    assert s["priority"] in ("high", "medium", "digest")
    assert "pipeline_label" in s

    # CRM match wins and carries the deep link.
    match = {"in_crm": True, "deal_count": 1, "owner": "Sam", "record_id": "r", "url": "https://crm/x"}
    s2 = core.qualify_signal({"company": "Newco", "round_stage": "Seed"}, "Accel", {}, None, match)
    assert s2["known_portco"] is True and s2["crm_url"] == "https://crm/x"
