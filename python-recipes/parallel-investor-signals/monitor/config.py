"""
config.py — the investor watchlist + monitor-side settings for the
Investor Signals pipeline.

The pipeline (see README-monitor.md):
  1. sweep.py    — Task API backfill: exhaustive look at the last N days per fund
                   (monitors can't do history).
  2. monitors.py — create one Parallel event_stream monitor per fund (daily).
  3. check.py    — drain new monitor events → dedupe vs the known-portco list →
                   verify via a chained follow-up Task → append to signals.json
                   → Slack (high/medium ping, digest rollup).

SAFE TO TWEAK: the fund list, queries, SWEEP_LOOKBACK_DAYS, processors.

The qualification schema, trigger/priority policy, and Slack formatting live in
project/backend/investor_core.py (ONE source of truth, shared with the web app
and the serverless webhook) and are re-exported here so monitor scripts keep a
single import surface.
"""

import json
import os
import sys
from pathlib import Path

# Bridge to the shared core in project/backend (monitor scripts already run on
# the backend venv, so its deps are available).
_PROJECT = Path(__file__).resolve().parents[1] / "project"
if str(_PROJECT) not in sys.path:
    sys.path.insert(0, str(_PROJECT))

from backend.investor_core import (  # noqa: E402,F401 — re-exported for sweep/check
    AI_NATIVE_DEF, FIT_RUBRIC, ROUND_SCHEMA, STAGES, STAGE_WEIGHT,
    VERIFY_PROCESSOR, priority_for, verify_input,
)

# ── The watchlist ────────────────────────────────────────────────────────────
# The funds you want to track. THIS IS YOURS TO OWN: copy investors.example.json
# to investors.json and list the VC funds you care about (one string per fund,
# as they appear in the press — "Sequoia Capital", "Andreessen Horowitz", …).
#
# Resolution order:
#   1. INVESTORS env var — comma-separated, wins if set (handy for CI / one-offs)
#   2. monitor/investors.json — your real watchlist (gitignored, never committed)
#   3. monitor/investors.example.json — the sample list, so a fresh clone runs
#
# investors.json is gitignored on purpose: your target list is your strategy.
_MONITOR_DIR = Path(__file__).resolve().parent
_INVESTORS_FILE = _MONITOR_DIR / "investors.json"
_INVESTORS_EXAMPLE = _MONITOR_DIR / "investors.example.json"


def load_investors() -> list[str]:
    """Resolve the fund watchlist (env → investors.json → investors.example.json).

    Accepts either a bare JSON array (["Fund A", "Fund B"]) or an object with an
    "investors" key ({"investors": ["Fund A", …]}). Blank/dupe entries dropped."""
    env = os.environ.get("INVESTORS")
    if env and env.strip():
        raw: list = [p for p in (s.strip() for s in env.split(",")) if p]
    else:
        path = _INVESTORS_FILE if _INVESTORS_FILE.exists() else _INVESTORS_EXAMPLE
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return []
        raw = data.get("investors", []) if isinstance(data, dict) else (data or [])
    seen, funds = set(), []
    for f in raw:
        name = str(f).strip()
        if name and name.lower() not in seen:
            seen.add(name.lower())
            funds.append(name)
    return funds


INVESTORS = load_investors()


# Detection query for the daily event_stream monitor of one fund.
def monitor_query(fund: str) -> str:
    return (
        f"New investment announcements where {fund} participated or led the round, "
        f"in AI-native companies ({AI_NATIVE_DEF}), at {STAGES} stage. "
        f"Funding round announcements, portfolio page additions, and press coverage count."
    )


# Bootstrap sweep (Task API) — exhaustive recent history for one fund.
SWEEP_LOOKBACK_DAYS = 60


def sweep_input(fund: str) -> str:
    return (
        f"List every funding round announced in the last {SWEEP_LOOKBACK_DAYS} days "
        f"where {fund} participated as an investor (lead or follow), the company is "
        f"AI-native ({AI_NATIVE_DEF}), and the round stage is {STAGES}. "
        f"Include the announcement date, round stage, amount, and co-investors. "
        f"Only include rounds you can support with a web source; do not guess."
    )


# Flat structured output for monitor events (core-processor complexity limit).
MONITOR_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "company_name": {"type": "string", "description": "Company that raised the round. NA if not a specific funding event."},
        "round_stage": {"type": "string", "description": "Stage, e.g. Seed, Series A, Series B. NA if unknown."},
        "amount": {"type": "string", "description": "Round size with currency, e.g. $25M. NA if undisclosed."},
        "announced_date": {"type": "string", "description": "Announcement date YYYY-MM-DD if known, else NA."},
        "investors": {"type": "string", "description": "Comma-separated investors named in the round."},
        "summary": {"type": "string", "description": "One-sentence description of the event."},
    },
    "required": ["company_name", "round_stage", "amount", "announced_date", "investors", "summary"],
}

# Processors: sweep favors recall (core); monitors run cheap (lite) daily;
# per-event verification uses base (VERIFY_PROCESSOR, from investor_core).
SWEEP_PROCESSOR = "core"
MONITOR_PROCESSOR = "lite"
MONITOR_FREQUENCY = "1d"
