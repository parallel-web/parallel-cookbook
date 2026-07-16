"""
check.py — drain new monitor events and run the monitor→task chain.

For every event we haven't seen:
  1. Parse the monitor's structured output (company, round, investors, …).
  2. VERIFY via a follow-up Task run, passing the event's `event_id` as
     `previous_interaction_id` — the documented chain that carries the monitor
     event's full research context into the Task and preserves provenance.
     The verification confirms: fund participation, seed–Series B stage, and
     AI-nativeness — with citations. Detection is cheap and wide; this gate is
     what keeps the signal feed high-precision.
  3. Label known portcos (never suppress — a round in a known portco is still
     news; pipeline-status suppression arrives with the CRM integration).
  4. Append to signals.json and print a digest.

Run on any cadence (manually, cron, or after `monitors.py trigger`):
    python monitor/check.py           # verify with follow-up tasks (default)
    python monitor/check.py --raw     # skip verification (just drain + label)
"""

from __future__ import annotations

import json
import sys

from common import (
    MONITORS_FILE, STATE_FILE, append_signals, client, known_portco,
    load_portfolio, print_signal, read_json, run_structured_task, utcnow,
    write_json,
)
from config import ROUND_SCHEMA, VERIFY_PROCESSOR, verify_input
from backend.investor_core import notify_signals_sync, qualify_signal, slack_enabled
from backend.crm import check_pipeline

# Safety bound on cursor-following so a huge backlog can't loop unbounded.
_MAX_EVENT_PAGES = 50


def events_for_monitor(c, monitor_id: str, per_page: int = 100) -> list:
    """All events for a monitor, following next_cursor (the API pages results;
    a single fixed page would silently drop events on a backlog)."""
    out: list = []
    cursor = None
    for _ in range(_MAX_EVENT_PAGES):
        kwargs = {"limit": per_page}
        if cursor:
            kwargs["cursor"] = cursor
        page = c.monitor.events(monitor_id, **kwargs)
        out.extend(getattr(page, "events", None) or [])
        cursor = getattr(page, "next_cursor", None)
        if not cursor:
            return out
    print(f"[check] event page cap ({_MAX_EVENT_PAGES}) hit for {monitor_id}; some events may be omitted")
    return out


def parse_event_content(event) -> dict:
    """Monitor structured output arrives as a JSON string in output.content."""
    content = getattr(event.output, "content", None) if getattr(event, "output", None) else None
    if isinstance(content, str):
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return {"summary": content}
    return content or {}


def event_citations(event) -> list:
    urls = []
    output = getattr(event, "output", None)
    for fb in (getattr(output, "basis", None) or []):
        for cit in (getattr(fb, "citations", None) or []):
            u = getattr(cit, "url", None)
            if u and u not in urls:
                urls.append(u)
    return urls


def verify_event(c, fund: str, detected: dict, event_id: str) -> list:
    """The follow-up-task chain: monitor event -> verified, cited rounds."""
    res = run_structured_task(
        c,
        verify_input(detected),
        ROUND_SCHEMA,
        VERIFY_PROCESSOR,
        previous_interaction_id=event_id,
    )
    out = []
    for r in res["content"].get("rounds", []):
        if str(r.get("is_ai_native", "")).lower() != "yes":
            continue
        out.append({**r, "sources": res["citations"], "verify_run_id": res["run_id"]})
    return out


def drain_events(c, portfolio: dict, monitors: dict, seen: set, *, raw: bool = False) -> list:
    """Drain unseen events across all monitors into fully-qualified signals.

    THE ONE drain path — shared by this CLI and the web app's local refresh, so
    they can't drift. Mutates `seen` with handled event ids. Each verified round
    goes through `qualify_signal` (CRM check → known/net-new flag → pipeline label
    → CRM link → priority), identical to the weekly digest and the webhook."""
    new_signals: list = []
    for fund, info in monitors.items():
        events = events_for_monitor(c, info["monitor_id"])
        fresh = [e for e in events if e.event_id not in seen]
        print(f"[check] {fund}: {len(events)} events, {len(fresh)} new")

        for e in fresh:
            seen.add(e.event_id)
            detected = parse_event_content(e)
            company = (detected.get("company_name") or "").strip()
            if not company or company.upper() == "NA":
                continue  # not a specific funding event

            base = {
                "fund_watched": fund,
                "detected_via": "monitor",
                "event_id": e.event_id,
                "event_date": str(getattr(e, "event_date", "") or ""),
                "detected_at": utcnow(),
            }

            if raw:
                new_signals.append({
                    "company": company,
                    "round_stage": detected.get("round_stage"),
                    "amount": detected.get("amount"),
                    "announced_date": detected.get("announced_date"),
                    "investors": detected.get("investors"),
                    "summary": detected.get("summary"),
                    "known_portco": bool(known_portco(company, portfolio)),
                    "sources": event_citations(e),
                    **base,
                })
                continue

            # Chained verification (previous_interaction_id = event_id), then the
            # shared qualification (live CRM check + priority + label).
            for r in verify_event(c, fund, detected, e.event_id):
                match = check_pipeline(r.get("domain"), r.get("company", ""))
                new_signals.append(qualify_signal(r, fund, portfolio, base, match))
    return new_signals


def main() -> None:
    raw = "--raw" in sys.argv
    c = client()
    portfolio = load_portfolio()
    monitors = read_json(MONITORS_FILE, {})
    if not monitors:
        raise SystemExit("No monitors yet — run: python monitor/monitors.py create")

    state = read_json(STATE_FILE, {"seen_event_ids": []})
    seen = set(state["seen_event_ids"])

    new_signals = drain_events(c, portfolio, monitors, seen, raw=raw)

    state["seen_event_ids"] = sorted(seen)
    write_json(STATE_FILE, state)
    added = append_signals(new_signals)

    print(f"\n=== CHECK DIGEST — {added} new signals ===")
    for s in new_signals:
        print_signal(s)
    if not new_signals:
        print("  (no new qualifying events)")

    # Slack delivery: high/medium ping individually,
    # digest-priority signals roll into one message. Quiet no-op if
    # SLACK_WEBHOOK_URL isn't set in the root .env.
    if new_signals:
        if slack_enabled():
            sent = notify_signals_sync(new_signals, "Investor signals — new events")
            print(f"[slack] {sent} message(s) posted")
        else:
            print("[slack] SLACK_WEBHOOK_URL not set — skipped (add it to .env to enable pings)")


if __name__ == "__main__":
    main()
