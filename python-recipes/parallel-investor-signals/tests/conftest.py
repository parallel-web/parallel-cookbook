"""
Shared fixtures. Test env vars are set BEFORE the app modules import (they
read env at import time), and they take precedence over any local .env because
load_dotenv() never overrides existing process env.

No test in this suite talks to Parallel, your CRM, or Slack — everything external
is monkeypatched.
"""

from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

# Deterministic test configuration — must precede backend imports.
os.environ.setdefault("PARALLEL_API_KEY", "test-parallel-key")
os.environ["DEMO_PASSWORD"] = "test-passphrase"
# A valid Standard Webhooks secret (whsec_ + base64 key) so signature tests can
# actually sign a request the receiver will accept.
WEBHOOK_SECRET = "whsec_" + base64.b64encode(b"test-webhook-signing-key-000001").decode()
os.environ["WEBHOOK_SECRET"] = WEBHOOK_SECRET
os.environ["CRON_SECRET"] = "test-cron-secret"
os.environ["APP_URL"] = "https://example.test"
os.environ.pop("SLACK_WEBHOOK_URL", None)  # Slack always disabled in tests
os.environ.pop("ATTIO_API_KEY", None)  # CRM always disabled in tests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "project"))

import pytest  # noqa: E402
from backend.main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

GATE_HEADERS = {"x-demo-key": "test-passphrase"}


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def sample_signal() -> dict:
    """A fully-populated verified signal, as produced by the pipeline."""
    return {
        "company": "Acme Robotics",
        "domain": "acme.ai",
        "round_stage": "Series A",
        "amount": "$25M",
        "amount_usd_millions": 25,
        "announced_date": "2026-07-08",
        "lead_investor": "Example Ventures",
        "co_investors": "Sample Capital, Angel One",
        "investing_partner": "Jane Doe at Example Ventures",
        "founders": "Ada Lovelace (CEO)",
        "sector": "AI infrastructure",
        "is_ai_native": "yes",
        "one_liner": "Builds robotic arms that learn from demonstration.",
        "parallel_fit_rating": 8,
        "fit_reasoning": "Agents need fresh web data for parts sourcing.",
        "priority": "high",
        "known_portco": False,
        "pipeline_label": "Not in Pipeline",
        "sources": ["https://news.example.com/acme-a", "https://acme.ai/blog"],
        "fund_watched": "Example Ventures",
        "detected_via": "monitor",
        "detected_at": "2026-07-09T12:00:00+00:00",
    }
