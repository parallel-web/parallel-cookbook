"""
monitors.py — manage the per-fund Parallel event_stream monitors.

One monitor per fund (scoped, intent-heavy queries beat one broad keyword net),
daily cadence, lite processor, flat structured output, include_backfill for a
sample of recent events on first run. No webhook needed for the polling path —
check.py drains events itself, so no public endpoint or delivery infra required.

Usage (from repo root, backend venv active):
    python monitor/monitors.py create    # one per fund in your watchlist (skips existing)
    python monitor/monitors.py list      # show ours + status
    python monitor/monitors.py trigger   # manually run each monitor now
    python monitor/monitors.py cancel    # cancel all ours
"""

from __future__ import annotations

import sys

from common import MONITORS_FILE, client, read_json, write_json, utcnow
from config import (
    MONITOR_FREQUENCY, MONITOR_OUTPUT_SCHEMA, MONITOR_PROCESSOR, monitor_query,
    require_investors,
)


def create() -> None:
    funds = require_investors()
    c = client()
    ours = read_json(MONITORS_FILE, {})
    for fund in funds:
        if fund in ours:
            print(f"[skip] {fund} → {ours[fund]['monitor_id']}")
            continue
        m = c.monitor.create(
            type="event_stream",
            frequency=MONITOR_FREQUENCY,
            processor=MONITOR_PROCESSOR,
            settings={
                "query": monitor_query(fund),
                "include_backfill": True,  # first run: sample of recent events
                "output_schema": {"type": "json", "json_schema": MONITOR_OUTPUT_SCHEMA},
            },
            metadata={"fund": fund[:60], "app": "inv-monitor-mvp"},
        )
        ours[fund] = {"monitor_id": m.monitor_id, "created_at": utcnow()}
        print(f"[created] {fund} → {m.monitor_id}")
    write_json(MONITORS_FILE, ours)


def list_() -> None:
    c = client()
    ours = read_json(MONITORS_FILE, {})
    for fund, info in ours.items():
        m = c.monitor.retrieve(info["monitor_id"])
        print(f"{fund:20} {m.monitor_id}  status={m.status}  freq={m.frequency}  processor={m.processor}")


def trigger() -> None:
    """Manually run each monitor now (also useful to test the drain chain
    without waiting for the daily schedule)."""
    c = client()
    ours = read_json(MONITORS_FILE, {})
    for fund, info in ours.items():
        c.monitor.trigger(info["monitor_id"])
        print(f"[triggered] {fund} ({info['monitor_id']})")


def cancel() -> None:
    c = client()
    ours = read_json(MONITORS_FILE, {})
    for fund, info in list(ours.items()):
        c.monitor.cancel(info["monitor_id"])
        print(f"[cancelled] {fund}")
        del ours[fund]
    write_json(MONITORS_FILE, ours)


def set_webhook() -> None:
    """Point every monitor's webhook at the deployed receiver (the webhook
    push pattern — no cron, no polling). Usage:
        python monitors.py set-webhook https://<your-deployment>.vercel.app

    No secret goes in the URL. Parallel signs every delivery (Standard Webhooks)
    with your account webhook secret; the receiver verifies that signature. Set
    WEBHOOK_SECRET on the deployment to your account secret (Parallel → Settings
    → Webhooks, `whsec_...`) so the receiver can verify — and never expose it in
    a query string."""
    if len(sys.argv) < 3:
        raise SystemExit("usage: python monitors.py set-webhook <app-base-url>")
    base = sys.argv[2].rstrip("/")
    url = f"{base}/api/monitor/webhook"
    c = client()
    ours = read_json(MONITORS_FILE, {})
    for fund, info in ours.items():
        c.monitor.update(
            info["monitor_id"],
            webhook={"url": url, "event_types": ["monitor.event.detected"]},
        )
        print(f"[webhook set] {fund} → {base}/api/monitor/webhook")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    {"create": create, "list": list_, "trigger": trigger, "cancel": cancel,
     "set-webhook": set_webhook}.get(cmd, list_)()
