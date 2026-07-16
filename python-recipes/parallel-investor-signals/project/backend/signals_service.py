"""
signals_service.py — surfaces the investor-monitoring signals in the web app.

Two modes, picked automatically:

  * VERIFIED (local dev): repo-root monitor/ exists → serve the qualified,
    chain-verified signals from monitor/signals.json, and support draining new
    events through the monitor→task verification on demand.

  * LIVE (serverless, e.g. Vercel): no monitor/ directory and no persistent
    filesystem → fetch RAW monitor events straight from the Parallel API on
    each request. Monitors are discovered live by their metadata tag
    (app=inv-monitor-mvp), so nothing is bundled or stored. Stateless by
    design: no seen-state, no chained verification — events are labeled
    unverified in the UI. The known-portco label still works via a bundled
    names-only list (backend/portfolio_names.json).

Set MONITOR_FORCE_LIVE=1 to exercise the live path locally.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
# Self-sufficient env loading (same convention as parallel_client): on Vercel
# there is no .env file and this quietly no-ops — platform env vars win.
load_dotenv(_REPO_ROOT / ".env")

from parallel import AsyncParallel  # noqa: E402

_MONITOR_DIR = _REPO_ROOT / "monitor"

_FORCE_LIVE = os.environ.get("MONITOR_FORCE_LIVE") == "1"
MONITORING_LOCAL = (_MONITOR_DIR / "check.py").exists() and not _FORCE_LIVE
if MONITORING_LOCAL and str(_MONITOR_DIR) not in sys.path:
    sys.path.insert(0, str(_MONITOR_DIR))

# Tag set on every monitor at creation — the live-discovery key.
_APP_TAG = "inv-monitor-mvp"

# Portfolio labeling + event parsing live in investor_core (shared with the
# monitor/ scripts and the webhook receiver).
from . import investor_core as _core  # noqa: E402


# ------------------------------------------------------------ verified mode --
def _list_signals_local() -> dict[str, Any]:
    """Local: qualified, chain-verified signals from monitor/signals.json."""
    from common import MONITORS_FILE, SIGNALS_FILE, read_json  # type: ignore

    signals = read_json(SIGNALS_FILE, [])
    monitors = [
        {"fund": fund, "monitor_id": info.get("monitor_id", "")}
        for fund, info in read_json(MONITORS_FILE, {}).items()
    ]
    signals.sort(key=lambda s: s.get("detected_at", ""), reverse=True)
    return {"available": True, "mode": "verified", "signals": signals, "monitors": monitors}


def _drain_local() -> dict[str, Any]:
    """Local: drain unseen events through the chained verification (see
    monitor/check.py — reused as the single source of truth)."""
    from check import parse_event_content, verify_event  # type: ignore
    from common import (  # type: ignore
        MONITORS_FILE,
        STATE_FILE,
        append_signals,
        known_portco,
        load_portfolio,
        read_json,
        utcnow,
        write_json,
    )
    from common import (
        client as monitor_client,
    )

    c = monitor_client()
    portfolio = load_portfolio()
    monitors = read_json(MONITORS_FILE, {})
    state = read_json(STATE_FILE, {"seen_event_ids": []})
    seen = set(state["seen_event_ids"])

    new_signals: list[dict[str, Any]] = []
    checked = 0
    for fund, info in monitors.items():
        result = c.monitor.events(info["monitor_id"], limit=50)
        for e in list(getattr(result, "events", None) or []):
            if e.event_id in seen:
                continue
            seen.add(e.event_id)
            checked += 1
            detected = parse_event_content(e)
            company = (detected.get("company_name") or "").strip()
            if not company or company.upper() == "NA":
                continue
            base = {
                "fund_watched": fund,
                "detected_via": "monitor",
                "event_id": e.event_id,
                "event_date": str(getattr(e, "event_date", "") or ""),
                "detected_at": utcnow(),
            }
            for r in verify_event(c, fund, detected, e.event_id):
                new_signals.append({
                    **r,
                    "known_portco": bool(known_portco(r.get("company", ""), portfolio)),
                    **base,
                })

    state["seen_event_ids"] = sorted(seen)
    write_json(STATE_FILE, state)
    added = append_signals(new_signals)
    return {"available": True, "mode": "verified", "checked": checked, "added": added}


# ----------------------------------------------------------------- live mode --
async def _list_signals_live() -> dict[str, Any]:
    """Serverless: discover our monitors by metadata tag and map their raw
    events into the Signal shape. Stateless — refetched every request, and
    NOT chain-verified (the UI labels this mode)."""
    key = os.environ.get("PARALLEL_API_KEY")
    if not key:
        return {"available": False, "mode": "live", "signals": [], "monitors": []}

    portfolio = _core.load_bundled_portfolio()
    client = AsyncParallel(api_key=key, timeout=60.0)
    try:
        listing = await client.monitor.list(limit=50, status="active")
        all_monitors = getattr(listing, "monitors", None) or getattr(listing, "data", None) or []
        ours = [
            m for m in all_monitors
            if (getattr(m, "metadata", None) or {}).get("app") == _APP_TAG
        ]

        async def events_for(m: Any) -> list[dict[str, Any]]:
            fund = (getattr(m, "metadata", None) or {}).get("fund", "watched fund")
            try:
                result = await client.monitor.events(m.monitor_id, limit=25)
            except Exception:  # noqa: BLE001 — one monitor failing shouldn't blank the page
                return []
            out = []
            for e in (getattr(result, "events", None) or []):
                d = _core.parse_event_content(e)
                company = (d.get("company_name") or "").strip()
                if not company or company.upper() == "NA":
                    continue
                out.append({
                    "company": company,
                    "round_stage": d.get("round_stage"),
                    "amount": d.get("amount"),
                    "announced_date": d.get("announced_date"),
                    "investors": d.get("investors"),
                    "summary": d.get("summary"),
                    "known_portco": _core.is_known_portco(company, portfolio),
                    "sources": _core.event_citations(e),
                    "fund_watched": fund,
                    "detected_via": "monitor",
                    "event_id": e.event_id,
                    "detected_at": str(getattr(e, "event_date", "") or ""),
                })
            return out

        batches = await asyncio.gather(*(events_for(m) for m in ours))
        signals = [s for b in batches for s in b]
        signals.sort(key=lambda s: s.get("detected_at", ""), reverse=True)
        return {
            "available": True,
            "mode": "live",
            "signals": signals,
            "monitors": [
                {"fund": (getattr(m, "metadata", None) or {}).get("fund", ""), "monitor_id": m.monitor_id}
                for m in ours
            ],
        }
    finally:
        await client.close()


# ------------------------------------------------------- weekly digest job ---
def within_last_days(date_str: str, days: int, now: datetime | None = None) -> bool:
    """STRICT window check used by the digest's date gates: the date must
    PARSE and fall inside the window. Missing/unparseable dates are excluded —
    never assumed fresh (this is what fences backfill/history out of the
    weekly recap)."""
    try:
        when = datetime.fromisoformat(str(date_str)).replace(tzinfo=UTC)
    except (ValueError, TypeError):
        return False
    now = now or datetime.now(UTC)
    return when >= now - timedelta(days=days)


async def run_weekly_digest() -> dict[str, Any]:
    """The Monday-9AM-PT recap (digest spec): collect last week's monitor
    events, verify each via the chained Task, CRM-check pipeline status,
    score priority, and post one headline + a thread of every round.

    Serverless-safe: events come straight from the Parallel API (stateless),
    verification fans out concurrently, CRM checks run in threads."""
    from parallel import AsyncParallel

    from . import crm
    from . import investor_core as core

    key = os.environ.get("PARALLEL_API_KEY")
    if not key:
        return {"ok": False, "error": "PARALLEL_API_KEY missing"}

    portfolio = core.load_bundled_portfolio()
    client = AsyncParallel(api_key=key, timeout=300.0)
    try:
        listing = await client.monitor.list(limit=50, status="active")
        monitors = [
            m for m in (getattr(listing, "monitors", None) or getattr(listing, "data", None) or [])
            if (getattr(m, "metadata", None) or {}).get("app") == _APP_TAG
        ]

        # 1. Collect last week's events across all fund monitors.
        candidates: list[dict[str, Any]] = []
        for m in monitors:
            fund = (getattr(m, "metadata", None) or {}).get("fund", "watched fund")
            try:
                result = await client.monitor.events(m.monitor_id, limit=50)
            except Exception:  # noqa: BLE001
                continue
            for e in (getattr(result, "events", None) or []):
                d = core.parse_event_content(e)
                company = (d.get("company_name") or "").strip()
                if not company or company.upper() == "NA":
                    continue
                # STRICT last-7-days gate #1: parseable event date inside the
                # window (see within_last_days — backfill/history fenced out).
                if not within_last_days(str(getattr(e, "event_date", "") or ""), 7):
                    continue
                candidates.append({"fund": fund, "detected": d, "event_id": e.event_id})

        # 2. Verify concurrently (chained follow-up tasks).
        async def verify(cand: dict[str, Any]) -> list[dict[str, Any]]:
            try:
                rounds = await core.averify_event(client, cand["detected"], cand["event_id"])
            except Exception:  # noqa: BLE001 — one bad verify shouldn't sink the digest
                return []
            return [{**r, "fund_watched": cand["fund"], "detected_via": "monitor",
                     "event_id": cand["event_id"]} for r in rounds]

        batches = await asyncio.gather(*(verify(c) for c in candidates))
        signals = [s for b in batches for s in b]

        # STRICT gate #2: the VERIFIED announcement date must also land in the
        # window (14-day grace for detection/announcement drift).
        signals = [s for s in signals if within_last_days(str(s.get("announced_date") or ""), 14)]

        # Dedupe by company+stage (several monitors can catch one round).
        seen, unique = set(), []
        for s in signals:
            k = (core.norm_company(s.get("company", "")), (s.get("round_stage") or "").lower())
            if k in seen:
                continue
            seen.add(k)
            unique.append(s)

        # 3. Pipeline status (live CRM when configured, local fallback) + priority.
        for s in unique:
            known = core.is_known_portco(s.get("company", ""), portfolio)
            match = await asyncio.to_thread(
                crm.check_pipeline, s.get("domain"), s.get("company", ""))
            s["known_portco"] = match["in_crm"] if match else known
            s["pipeline_label"] = crm.pipeline_label(match, known)
            s["crm_url"] = (match or {}).get("url")
            s["priority"] = core.priority_for(
                s.get("round_stage", ""), s.get("amount_usd_millions", 0),
                s.get("parallel_fit_rating", 0), bool(s["known_portco"]))

        # 4. Post: headline + thread (bot token) or flat fallback (webhook).
        week_label = (datetime.now(UTC) - timedelta(days=7)).strftime("%B %-d")
        unique.sort(key=lambda s: ({"high": 0, "medium": 1}.get(s.get("priority", ""), 2)))
        result = await asyncio.to_thread(core.post_weekly_digest_sync, week_label, unique)
        return {"ok": True, "events_considered": len(candidates),
                "signals": len(unique), **result}
    finally:
        await client.close()


# ------------------------------------------------------------------ public --
async def list_signals() -> dict[str, Any]:
    if MONITORING_LOCAL:
        return await asyncio.to_thread(_list_signals_local)
    return await _list_signals_live()


async def drain_new_events() -> dict[str, Any]:
    if MONITORING_LOCAL:
        return await asyncio.to_thread(_drain_local)
    # Live mode is stateless — every page load already fetches the latest
    # events, so there is nothing to drain or persist.
    return {"available": False, "mode": "live", "checked": 0, "added": 0}
