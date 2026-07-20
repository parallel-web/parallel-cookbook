"""
webhook_verify.py — verify Parallel webhook signatures (Standard Webhooks).

Parallel signs every webhook with your account webhook secret (Settings →
Webhooks, `whsec_...`) using the Standard Webhooks scheme:
https://github.com/standard-webhooks/standard-webhooks

Signature = base64( HMAC-SHA256( key, f"{webhook-id}.{webhook-timestamp}.{body}" ) )
where `key` is the secret with its `whsec_` prefix stripped, then base64-decoded.
The `webhook-signature` header is a space-delimited list of `v1,<base64sig>`
entries (more than one only during secret rotation); any match verifies.

Fail CLOSED: the caller must reject the request when the secret is unset or when
verification raises. Kept dependency-free (stdlib hmac) so it's easy to test.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
from collections.abc import Mapping

# Default replay window, matching the Standard Webhooks recommendation.
DEFAULT_TOLERANCE_SECONDS = 300


class WebhookVerificationError(Exception):
    """Raised when a webhook request cannot be verified. Caller returns 401."""


def _signing_key(secret: str) -> bytes:
    trimmed = secret[len("whsec_"):] if secret.startswith("whsec_") else secret
    try:
        return base64.b64decode(trimmed)
    except Exception as exc:  # noqa: BLE001
        raise WebhookVerificationError("webhook secret is not valid base64") from exc


def verify(
    body: bytes,
    headers: Mapping[str, str],
    secret: str,
    *,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    now: int | None = None,
) -> None:
    """Verify a Standard Webhooks request. Returns None on success; raises
    WebhookVerificationError otherwise. `headers` is case-insensitive when it's a
    Starlette/requests Headers object; a plain dict must use lowercase keys."""
    if not secret:
        raise WebhookVerificationError("webhook secret not configured")

    wid = headers.get("webhook-id")
    ts = headers.get("webhook-timestamp")
    sig_header = headers.get("webhook-signature")
    if not (wid and ts and sig_header):
        raise WebhookVerificationError("missing webhook-id / -timestamp / -signature header")

    try:
        ts_int = int(ts)
    except (TypeError, ValueError) as exc:
        raise WebhookVerificationError("webhook-timestamp is not an integer") from exc
    current = int(time.time()) if now is None else now
    if abs(current - ts_int) > tolerance_seconds:
        raise WebhookVerificationError("webhook-timestamp outside tolerance (replay?)")

    signed_content = wid.encode() + b"." + ts.encode() + b"." + body
    expected = base64.b64encode(
        hmac.new(_signing_key(secret), signed_content, hashlib.sha256).digest()
    ).decode()

    for part in sig_header.split(" "):
        candidate = part.split(",", 1)[1] if "," in part else part
        if hmac.compare_digest(candidate, expected):
            return
    raise WebhookVerificationError("no matching signature")
