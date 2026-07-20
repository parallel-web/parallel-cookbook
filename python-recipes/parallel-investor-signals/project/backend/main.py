"""
main.py — FastAPI app for the Parallel Sales Enrichment demo.

Boring and reliable on purpose: no auth, no DB, no queue. All Parallel calls
live in parallel_client.py; this file only does HTTP plumbing, input validation,
concurrency limiting for bulk jobs, and CSV export.

Run it (from project/):
    source backend/.venv/bin/activate
    uvicorn backend.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import csv
import hmac
import io
import json
import os
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import parallel_client as pc
from . import signals_service, webhook_verify
from .models import BulkRequest, EnrichRequest

# True on Vercel (and similar) serverless hosts, where per-instance in-memory
# state (bulk jobs) and post-response work are unreliable. Set by the platform.
_IS_SERVERLESS = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))

app = FastAPI(title="Parallel Sales Enrichment API", version="1.0.0")

# CORS for the Vite dev server. In dev the frontend usually proxies /api to
# :8000 (same-origin), but allowing these origins makes direct browser calls
# work too — handy during a live demo if the proxy isn't used.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------------------- access gate --
# Shared-passphrase gate for the demo. Enforced SERVER-SIDE on every /api route
# (except /api/health, which leaks nothing) so the hosted API can't be hit
# directly and burn credits. This is a demo gate, not real auth — rotate the
# passphrase via the DEMO_PASSWORD env var (Vercel env / root .env) without a
# code change.
# No hardcoded default: the gate is CLOSED until DEMO_PASSWORD is configured.
# (Self-hosters must choose a passphrase; an unset var never means "open".)
_DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "")
# Paths that stay open: liveness, plus the Parallel monitor webhook and the
# cron-invoked weekly digest (neither caller can send our demo header — both
# carry their own shared secrets).
_GATE_EXEMPT = {"/api/health", "/api/monitor/webhook", "/api/signals/weekly-digest"}


def _key_ok(candidate: str | None) -> bool:
    if not _DEMO_PASSWORD:
        return False  # gate unconfigured -> closed
    return bool(candidate) and hmac.compare_digest(candidate, _DEMO_PASSWORD)


@app.middleware("http")
async def demo_access_gate(request: Request, call_next):
    """Require the passphrase in a header on every protected API route."""
    path = request.url.path
    if path.startswith("/api") and path not in _GATE_EXEMPT:
        supplied = request.headers.get("x-demo-key")
        if not _key_ok(supplied):
            detail = (
                "Access gate not configured. Set the DEMO_PASSWORD environment "
                "variable on the server to enable access."
                if not _DEMO_PASSWORD
                else "Access key required. Enter the demo passphrase to continue."
            )
            return JSONResponse(status_code=401, content={"detail": detail})
    return await call_next(request)


# In-memory bulk job store. Fine for a demo; resets on restart (documented).
_BULK_JOBS: dict[str, dict[str, Any]] = {}
# Cap concurrent per-row enrichments so a big CSV can't stampede the API.
_BULK_CONCURRENCY = 5


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


# ------------------------------------------------------------------ health ----
@app.get("/api/health")
def health() -> dict[str, Any]:
    """Liveness + config check. Returns key_loaded as a BOOL only — never the key."""
    return {"status": "ok", "key_loaded": pc.api_key_loaded(), "time": _utcnow()}


@app.get("/api/auth/check")
def auth_check() -> dict[str, Any]:
    """Passphrase verification for the unlock screen. Protected by the gate
    middleware like every other route, so reaching it at all means the supplied
    key was correct. Costs nothing — no Parallel call."""
    return {"ok": True}


# ---------------------------------------------------------- investor signals --
@app.get("/api/signals")
async def signals() -> dict[str, Any]:
    """Investor-monitoring signals. Local dev: verified signals from the repo's
    monitor/ files. Serverless: stateless live fetch of raw monitor events
    straight from the Parallel API (mode='live', unverified)."""
    return await signals_service.list_signals()


@app.post("/api/signals/refresh")
async def signals_refresh() -> dict[str, Any]:
    """Drain unseen monitor events through the chained verification (local mode
    only — live mode refetches on every load, so there's nothing to drain)."""
    return await signals_service.drain_new_events()


@app.get("/api/signals/weekly-digest")
@app.post("/api/signals/weekly-digest")
async def weekly_digest(request: Request) -> dict[str, Any]:
    """Weekly recap of last week's rounds (digest spec): one headline + a thread
    with every verified, CRM-checked, scored signal.

    Auth FAILS CLOSED: this route is exempt from the passphrase gate, so it is
    protected only by CRON_SECRET. Vercel Cron sends `Authorization: Bearer
    <CRON_SECRET>` automatically when the var is set. If CRON_SECRET is unset the
    route is disabled (503) rather than open — a missing secret never means
    'public'. To trigger manually, set CRON_SECRET and send the same Bearer header."""
    cron_secret = os.environ.get("CRON_SECRET")
    if not cron_secret:
        raise HTTPException(503, "Weekly digest disabled: set CRON_SECRET to enable it.")
    if not hmac.compare_digest(
        request.headers.get("authorization", ""), f"Bearer {cron_secret}"
    ):
        raise HTTPException(401, "missing or invalid cron authorization")
    result = await signals_service.run_weekly_digest()
    # stdout lands in the platform function logs — invocation observability
    print(f"[weekly-digest] {result}")
    return result


# Best-effort in-memory idempotency for webhook retries, keyed by webhook-id.
# Reserving before the side effects prevents concurrent duplicate processing;
# failed attempts release their reservation so Standard Webhooks can retry.
# This survives only within one process/instance — on serverless it is a soft
# guard, not a guarantee. For production, dedupe against a durable store (Redis,
# a DB unique key on webhook-id) and, ideally, ACK immediately then process the
# event on a queue rather than inline as below.
_SEEN_WEBHOOK_IDS: dict[str, float] = {}
_SEEN_MAX = 4000


def _reserve_webhook(webhook_id: str) -> bool:
    """Reserve a delivery ID. False means another attempt owns/completed it."""
    if webhook_id in _SEEN_WEBHOOK_IDS:
        return False
    _SEEN_WEBHOOK_IDS[webhook_id] = time.time()
    if len(_SEEN_WEBHOOK_IDS) > _SEEN_MAX:  # trim oldest half
        for k in sorted(_SEEN_WEBHOOK_IDS, key=_SEEN_WEBHOOK_IDS.get)[: _SEEN_MAX // 2]:
            _SEEN_WEBHOOK_IDS.pop(k, None)
    return True


def _release_webhook(webhook_id: str) -> None:
    """Make a failed delivery retryable without weakening in-flight dedupe."""
    _SEEN_WEBHOOK_IDS.pop(webhook_id, None)


@app.post("/api/monitor/webhook")
async def monitor_webhook(request: Request) -> dict[str, Any]:
    """Parallel calls this when a fund monitor detects a change.

    Exempt from the passphrase gate; secured instead by verifying the Standard
    Webhooks signature against WEBHOOK_SECRET (your account webhook secret,
    `whsec_...`, from Parallel → Settings → Webhooks). FAILS CLOSED: no secret
    configured or a bad/missing signature → rejected, never processed. Retries
    are deduped by webhook-id so a redelivery doesn't double-spend or double-post.

    Flow per event: verify signature → parse → dedupe → chained follow-up Task →
    CRM check → priority → Slack ping. NOTE: research + delivery run inline here
    for recipe simplicity; a production receiver should ACK 2xx immediately and
    process on a durable queue (see the idempotency note above)."""
    from parallel import AsyncParallel

    from . import crm
    from . import investor_core as core

    # 1) Verify the signature (fail closed).
    body = await request.body()
    secret = os.environ.get("WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(503, "Webhook receiver disabled: set WEBHOOK_SECRET (your Parallel account webhook secret).")
    try:
        webhook_verify.verify(body, request.headers, secret)
    except webhook_verify.WebhookVerificationError as exc:
        raise HTTPException(401, f"webhook signature verification failed: {exc}") from exc

    # 2) Validate the delivery before reserving its ID. Configuration or payload
    # errors must remain retryable once corrected.
    payload = json.loads(body)
    if payload.get("type") != "monitor.event.detected":
        return {"ok": True, "ignored": True}

    data = payload.get("data") or {}
    monitor_id = data.get("monitor_id")
    group_id = (data.get("event") or {}).get("event_group_id")
    fund = (data.get("metadata") or {}).get("fund", "watched fund")
    if not monitor_id or not group_id:
        return {"ok": True, "ignored": True}

    key = os.environ.get("PARALLEL_API_KEY")
    if not key:
        raise HTTPException(500, "Server missing PARALLEL_API_KEY.")

    # 3) Reserve immediately before side effects. Keep the reservation after a
    # successful response; release it on errors/cancellation so retries can run.
    webhook_id = request.headers.get("webhook-id", "")
    if webhook_id and not _reserve_webhook(webhook_id):
        return {"ok": True, "duplicate": True}

    try:
        portfolio = core.load_bundled_portfolio()
        client = AsyncParallel(api_key=key, timeout=300.0)
        posted = 0
        try:
            result = await client.monitor.events(monitor_id, event_group_id=group_id)
            for e in (getattr(result, "events", None) or []):
                detected = core.parse_event_content(e)
                company = (detected.get("company_name") or "").strip()
                if not company or company.upper() == "NA":
                    continue
                for r in await core.averify_event(client, detected, e.event_id):
                    # Live CRM check (same as the digest + CLI paths), off-thread so
                    # the sync httpx call doesn't block the event loop.
                    match = await asyncio.to_thread(
                        crm.check_pipeline, r.get("domain"), r.get("company", "")
                    )
                    signal = core.qualify_signal(
                        r, fund, portfolio, {"detected_via": "monitor", "event_id": e.event_id}, match
                    )
                    # Trigger policy: only high/medium ping; digest-priority events
                    # are dropped here (they surface in the app's live view).
                    if signal["priority"] in ("high", "medium"):
                        if await core.apost_to_slack(
                            core.build_signal_blocks(signal),
                            f"{signal.get('company')}, {signal.get('round_stage')}",
                        ):
                            posted += 1
        finally:
            await client.close()
    except (Exception, asyncio.CancelledError):
        if webhook_id:
            _release_webhook(webhook_id)
        raise
    return {"ok": True, "posted": posted}


# ------------------------------------------------------------------ enrich ----
@app.post("/api/enrich")
async def enrich(req: EnrichRequest) -> dict[str, Any]:
    """Single-company enrichment -> one cited ResearchBrief."""
    if not pc.api_key_loaded():
        raise HTTPException(500, "Server missing PARALLEL_API_KEY.")
    try:
        return await pc.enrich(req.query, req.depth, [d.model_dump() for d in req.custom_fields])
    except pc.ParallelConfigError as exc:
        raise HTTPException(500, str(exc)) from exc
    except pc.ParallelCallError as exc:
        # Surface the friendly message + the status hint we derived from the SDK.
        raise HTTPException(exc.status, exc.message) from exc


# ----------------------------------------------------- custom-only enrich ----
@app.post("/api/enrich/custom")
async def enrich_custom(req: EnrichRequest) -> dict[str, Any]:
    """Research ONLY the requested custom fields for one company — no account/
    contacts re-run. Lets the UI append answers to an already-loaded brief."""
    if not pc.api_key_loaded():
        raise HTTPException(500, "Server missing PARALLEL_API_KEY.")
    if not req.custom_fields:
        return {"custom_fields": [], "run_ids": []}
    try:
        return await pc.enrich_custom_only(
            req.query, req.depth, [d.model_dump() for d in req.custom_fields]
        )
    except pc.ParallelConfigError as exc:
        raise HTTPException(500, str(exc)) from exc
    except pc.ParallelCallError as exc:
        raise HTTPException(exc.status, exc.message) from exc


# ------------------------------------------------------------- bulk enrich ----
async def _run_bulk_job(
    job_id: str, companies: list[str], depth: str, custom_defs: list[dict[str, Any]]
) -> None:
    """Background task: enrich every row with bounded concurrency, isolating
    per-row failures so one bad company never sinks the whole job."""
    job = _BULK_JOBS[job_id]
    sem = asyncio.Semaphore(_BULK_CONCURRENCY)
    results: list[dict[str, Any] | None] = [None] * len(companies)

    async def do_row(i: int, company: str) -> None:
        async with sem:
            try:
                brief = await pc.enrich(company, depth, custom_defs)
            except pc.ParallelCallError as exc:
                brief = _error_brief(company, exc.message, custom_defs)
            except Exception as exc:  # noqa: BLE001 — never let one row kill the job
                brief = _error_brief(company, f"Enrichment failed: {type(exc).__name__}", custom_defs)
            results[i] = brief
            job["done"] += 1
            # Publish incrementally so polling shows live progress.
            job["results"] = [r for r in results if r is not None]

    try:
        await asyncio.gather(*(do_row(i, c) for i, c in enumerate(companies)))
        job["results"] = [r for r in results if r is not None]
        job["status"] = "done"
    except Exception as exc:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = f"Bulk job failed: {type(exc).__name__}"


def _error_brief(
    company: str, message: str, custom_defs: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    """A valid (empty) ResearchBrief carrying an error note for a failed row.
    Synthesizes a nulled custom result so failed rows still carry stable (blank)
    custom columns."""
    custom_result = (
        {"defs": custom_defs, "content": {}, "basis": []} if custom_defs else None
    )
    brief = pc.to_research_brief(
        company, None, None,
        {"processor": "", "run_ids": [], "latency_ms": 0, "partial": True},
        custom_result,
    )
    brief["error"] = message
    return brief


@app.post("/api/enrich/bulk")
async def enrich_bulk(req: BulkRequest) -> dict[str, Any]:
    """Kick off a bulk enrichment. Returns {job_id} immediately; poll the status
    endpoint for progress + results."""
    if not pc.api_key_loaded():
        raise HTTPException(500, "Server missing PARALLEL_API_KEY.")
    if _IS_SERVERLESS:
        # Bulk needs a persistent process: job state lives in memory and the work
        # continues after the response returns. Serverless instances can freeze or
        # be recycled between the kickoff and the poll, so refuse rather than
        # start a job that may silently stall. Run bulk against a local/self-hosted
        # backend, or wire it to durable background infrastructure.
        raise HTTPException(
            501,
            "Bulk mode is unavailable on serverless deployments (in-memory job "
            "state does not survive instance hops). Run it against a local or "
            "self-hosted backend.",
        )
    companies = [r.company for r in req.rows]
    custom_defs = [d.model_dump() for d in req.custom_fields]
    job_id = uuid.uuid4().hex
    _BULK_JOBS[job_id] = {
        "status": "running",
        "done": 0,
        "total": len(companies),
        "results": [],
        "created_at": _utcnow(),
        "depth": req.depth,
        "custom_defs": custom_defs,
    }
    # Fire-and-forget background task (asyncio, no extra infra).
    asyncio.create_task(_run_bulk_job(job_id, companies, req.depth, custom_defs))
    return {"job_id": job_id}


@app.get("/api/enrich/bulk/{job_id}")
def bulk_status(job_id: str) -> dict[str, Any]:
    job = _BULK_JOBS.get(job_id)
    if job is None:
        # In-memory store: on serverless hosting (e.g. Vercel), polls can land
        # on a different instance than the one running the job. Be honest.
        raise HTTPException(
            404,
            "Bulk job not found — job state is in-memory and may not persist on "
            "serverless hosting. Run bulk mode against the local backend.",
        )
    return {
        "job_id": job_id,
        "status": job["status"],
        "done": job["done"],
        "total": job["total"],
        "results": job["results"],
        "error": job.get("error"),
    }


# --------------------------------------------------------------- csv export ---
# Cells that a spreadsheet would evaluate as a formula. Web-/user-derived text
# (company names, notes, custom answers) is written verbatim, so a value like
# "=HYPERLINK(...)" or "+cmd" could execute when a rep opens the CSV in Excel or
# Sheets. We prefix such cells with a single quote in the CSV only; the JSON API
# response keeps the original, unaltered value.
_CSV_FORMULA_LEAD = ("=", "+", "-", "@", "\t", "\r", "\n")


def _csv_safe(value: str) -> str:
    return "'" + value if value and value[0] in _CSV_FORMULA_LEAD else value


def _flat(field: Any) -> str:
    """Field<T>.value -> human string ('' if null). Handles str, list, and the
    buying_signals list-of-objects."""
    if not isinstance(field, dict):
        return ""
    value = field.get("value")
    if value is None:
        return ""
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, dict):  # buying signal
                head = item.get("headline", "")
                date = item.get("date", "")
                parts.append(f"{head} ({date})" if date else head)
            else:
                parts.append(str(item))
        return "; ".join(p for p in parts if p)
    return str(value)


def _all_source_urls(brief: dict[str, Any]) -> list[str]:
    """Collect every citation URL across the whole brief (deduped, ordered)."""
    urls: list[str] = []

    def collect(field: Any) -> None:
        if isinstance(field, dict) and "citations" in field:
            for c in field.get("citations") or []:
                u = c.get("url")
                if u and u not in urls:
                    urls.append(u)

    for group in ("firmographics", "funding", "technographics"):
        for f in (brief.get(group) or {}).values():
            collect(f)
    collect(brief.get("buying_signals"))
    for contact in brief.get("contacts") or []:
        for f in contact.values():
            collect(f)
    for cf in brief.get("custom_fields") or []:
        collect(cf.get("field"))
    return urls


@app.get("/api/enrich/bulk/{job_id}/export.csv")
def bulk_export_csv(job_id: str) -> StreamingResponse:
    """Stream the enriched results as a flat, human-readable CSV."""
    job = _BULK_JOBS.get(job_id)
    if job is None:
        raise HTTPException(
            404,
            "Bulk job not found — job state is in-memory and may not persist on "
            "serverless hosting. Run bulk mode against the local backend.",
        )

    # Custom-field columns (batch-level defs stored on the job). Header is the
    # human label, deduped against fixed columns + each other; the brief is
    # indexed by the stable slug key. Inserted before the processor/meta columns.
    custom_defs = job.get("custom_defs") or []
    lead_columns = [
        "query", "company_name", "domain",
        "industry", "hq", "employee_count", "founded_year", "description",
        "total_raised", "last_round", "investors", "valuation", "revenue_estimate",
        "tech_stack", "buying_signals", "contacts",
    ]
    trail_columns = ["processor", "partial", "error", "sources"]
    custom_cols: list[tuple] = []  # (slug_key, header)
    used = set(lead_columns) | set(trail_columns)
    for d in custom_defs:
        base = d.get("label") or d.get("key") or "custom"
        header, n = base, 2
        while header in used:
            header, n = f"{base} ({n})", n + 1
        used.add(header)
        custom_cols.append((d.get("key"), header))

    columns = lead_columns + [h for _, h in custom_cols] + trail_columns

    def row_for(brief: dict[str, Any]) -> dict[str, str]:
        firmo = brief.get("firmographics") or {}
        fund = brief.get("funding") or {}
        tech = brief.get("technographics") or {}
        contacts_str = "; ".join(
            f"{_flat(c.get('name'))} — {_flat(c.get('title'))}".strip(" —")
            for c in (brief.get("contacts") or [])
            if _flat(c.get("name"))
        )
        cf_map = {c.get("key"): c.get("field") for c in (brief.get("custom_fields") or [])}
        row = {
            "query": brief.get("query", ""),
            "company_name": brief.get("company_name", ""),
            "domain": brief.get("domain") or "",
            "industry": _flat(firmo.get("industry")),
            "hq": _flat(firmo.get("hq")),
            "employee_count": _flat(firmo.get("employee_count")),
            "founded_year": _flat(firmo.get("founded_year")),
            "description": _flat(firmo.get("description")),
            "total_raised": _flat(fund.get("total_raised")),
            "last_round": _flat(fund.get("last_round")),
            "investors": _flat(fund.get("investors")),
            "valuation": _flat(fund.get("valuation")),
            "revenue_estimate": _flat(fund.get("revenue_estimate")),
            "tech_stack": _flat(tech.get("tech_stack")),
            "buying_signals": _flat(brief.get("buying_signals")),
            "contacts": contacts_str,
            "processor": (brief.get("meta") or {}).get("processor", ""),
            "partial": str((brief.get("meta") or {}).get("partial", "")),
            "error": brief.get("error", ""),
            "sources": " | ".join(_all_source_urls(brief)),
        }
        for key, header in custom_cols:
            row[header] = _flat(cf_map.get(key))
        # Neutralize formula injection on every textual cell before it's written.
        return {k: _csv_safe(v if isinstance(v, str) else str(v)) for k, v in row.items()}

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns)
    writer.writeheader()
    for brief in job.get("results") or []:
        writer.writerow(row_for(brief))
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="enrichment-{job_id[:8]}.csv"'},
    )
