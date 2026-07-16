"""
slack_notify.py — preview or send the Slack format for investor signals.

The formatting lives in project/backend/investor_core.py (Block Kit house
style: emoji header, `•` context line, labeled sections, 📎 numbered sources).
Delivery is an incoming webhook: set SLACK_WEBHOOK_URL in the repo-root .env.

Usage (backend venv active):
    python monitor/slack_notify.py --preview          # print blocks for the newest signal
    python monitor/slack_notify.py --send             # actually post the newest signal
    python monitor/slack_notify.py --send-all-new     # post everything from the last check
"""

from __future__ import annotations

import json
import sys

import config  # noqa: F401 — sets up the sys.path bridge to project/backend; must come first
from common import SIGNALS_FILE, read_json
from backend.crm import check_pipeline, pipeline_label
from backend.investor_core import (
    build_signal_blocks, notify_signals_sync, post_to_slack, slack_enabled,
)


def with_live_pipeline(s: dict) -> dict:
    """Attach a fresh CRM pipeline label at send time (stored signals may
    predate the CRM integration)."""
    match = check_pipeline(s.get("domain"), s.get("company", ""))
    return {**s, "pipeline_label": pipeline_label(match, bool(s.get("known_portco"))),
            "crm_url": (match or {}).get("url")}


def main() -> None:
    signals = read_json(SIGNALS_FILE, [])
    if not signals:
        raise SystemExit("No signals in monitor/signals.json yet.")
    signals.sort(key=lambda s: s.get("detected_at", ""), reverse=True)
    newest = signals[0]

    if "--send" in sys.argv:
        if not slack_enabled():
            raise SystemExit("SLACK_WEBHOOK_URL not set in the root .env.")
        s = with_live_pipeline(newest)
        ok = post_to_slack(build_signal_blocks(s), f"{s['company']} — {s.get('round_stage')}")
        print(f"posted: {ok} ({s['company']}) — pipeline: {s['pipeline_label']}")
    elif "--send-all-new" in sys.argv:
        if not slack_enabled():
            raise SystemExit("SLACK_WEBHOOK_URL not set in the root .env.")
        sent = notify_signals_sync(signals, "Investor signals — backfill digest")
        print(f"posted {sent} message(s)")
    else:
        print(f"— Slack preview for: {newest['company']} —")
        print(json.dumps(build_signal_blocks(newest), indent=2))
        print(f"\nslack_enabled: {slack_enabled()}  (set SLACK_WEBHOOK_URL in .env to deliver)")


if __name__ == "__main__":
    main()
