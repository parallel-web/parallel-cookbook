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

# Safety bound on cursor-following so a huge backlog can't loop unbounded.
_MAX_PAGES = 50


async def _all_active_monitors(client: AsyncParallel) -> list[Any]:
    """Every active monitor, following next_cursor (the API pages results, so a
    single fixed page would silently omit monitors on a larger installation)."""
    out: list[Any] = []
    cursor: str | None = None
    for _ in range(_MAX_PAGES):
        kwargs: dict[str, Any] = {"limit": 100, "status": ["active"]}
        if cursor:
            kwargs["cursor"] = cursor
        page = await client.monitor.list(**kwargs)
        out.extend(getattr(page, "monitors", None) or getattr(page, "data", None) or [])
        cursor = getattr(page, "next_cursor", None)
        if not cursor:
            break
    return out


async def _all_events(client: AsyncParallel, monitor_id: str, per_page: int = 100) -> list[Any]:
    """Every event for a monitor, following next_cursor."""
    out: list[Any] = []
    cursor: str | None = None
    for _ in range(_MAX_PAGES):
        kwargs: dict[str, Any] = {"limit": per_page}
        if cursor:
            kwargs["cursor"] = cursor
        page = await client.monitor.events(monitor_id, **kwargs)
        out.extend(getattr(page, "events", None) or [])
        cursor = getattr(page, "next_cursor", None)
        if not cursor:
            break
    return out


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
    """Local: drain unseen events through THE shared drain path (check.drain_events),
    so the web refresh produces exactly the same fully-qualified signals as the
    CLI — CRM check, pipeline label, and priority included (no drift). The CLI
    additionally pings Slack; a UI refresh deliberately does not."""
    from check import drain_events  # type: ignore — the one drain implementation
    from common import (  # type: ignore
        MONITORS_FILE,
        STATE_FILE,
        append_signals,
        load_portfolio,
        read_json,
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
    before = len(seen)

    new_signals = drain_events(c, portfolio, monitors, seen)

    state["seen_event_ids"] = sorted(seen)
    write_json(STATE_FILE, state)
    added = append_signals(new_signals)
    return {"available": True, "mode": "verified", "checked": len(seen) - before, "added": added}


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
        all_monitors = await _all_active_monitors(client)
        ours = [
            m for m in all_monitors
            if (getattr(m, "metadata", None) or {}).get("app") == _APP_TAG
        ]

        async def events_for(m: Any) -> list[dict[str, Any]]:
            fund = (getattr(m, "metadata", None) or {}).get("fund", "watched fund")
            try:
                events = await _all_events(client, m.monitor_id)
            except Exception:  # noqa: BLE001 — one monitor failing shouldn't blank the page
                return []
            out = []
            for e in events:
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
    """The weekly recap (digest spec): collect last week's monitor events,
    verify each via the chained Task, CRM-check pipeline status, score priority,
    and post one headline + a thread of every round.

    Scheduled by Vercel Cron at 15:00 UTC every Monday (see vercel.json). That is
    a FIXED UTC time: Vercel evaluates cron in UTC, so it lands at 07:00 PT under
    PDT and 08:00 PT under PST and does not auto-adjust for daylight saving. Pick
    the UTC hour you want, or gate on Pacific time in code if 9 AM PT matters.

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
        monitors = [
            m for m in await _all_active_monitors(client)
            if (getattr(m, "metadata", None) or {}).get("app") == _APP_TAG
        ]

        # 1. Collect last week's events across all fund monitors.
        candidates: list[dict[str, Any]] = []
        for m in monitors:
            fund = (getattr(m, "metadata", None) or {}).get("fund", "watched fund")
            try:
                events = await _all_events(client, m.monitor_id)
            except Exception:  # noqa: BLE001
                continue
            for e in events:
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

        # 3. Qualify each signal through the SHARED path (CRM check → known/net-new
        # flag → pipeline label → CRM link → priority), identical to the CLI drain
        # and the webhook. CRM lookups run off-thread (sync httpx).
        qualified: list[dict[str, Any]] = []
        for s in unique:
            match = await asyncio.to_thread(
                crm.check_pipeline, s.get("domain"), s.get("company", ""))
            qualified.append(core.qualify_signal(s, s.get("fund_watched", ""), portfolio, None, match))
        unique = qualified

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
