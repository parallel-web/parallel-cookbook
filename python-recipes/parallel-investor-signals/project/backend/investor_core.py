"""
investor_core.py — the shared core of the Investor Signals pipeline:
qualification schema, trigger/priority policy, event parsing, and Block Kit
Slack formatting.

ONE source of truth used from three surfaces:
  * repo-root monitor/ scripts (sweep.py / check.py / slack_notify.py)
  * the local FastAPI app (signals_service.py)
  * the serverless webhook receiver (/api/monitor/webhook on Vercel)

Slack conventions follow a consistent Block Kit house style:
emoji-prefixed header; a `context` line of `•`-separated metadata;
one `section` per labeled field; `📎 Sources:` as numbered links capped at 5.
Delivery is an incoming webhook (SLACK_WEBHOOK_URL) that quietly no-ops when
unset — so the pipeline runs identically with Slack on or off.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import httpx

# Per-field citations on task outputs (same beta as the enrichment backend).
FIELD_BASIS_BETA = "field-basis-2025-11-25"

# ------------------------------------------------------------- qualification --
STAGES = "pre-seed, seed, Series A, or Series B"

AI_NATIVE_DEF = (
    "the company's core product is an AI model, AI infrastructure/tooling, "
    "or an AI-first application — not merely a company that uses AI"
)

FIT_RUBRIC = (
    "Rate 1-10 how strong a prospect this company is for Parallel Web Systems "
    "(APIs for live web research: search, structured enrichment, monitoring, "
    "deep research for AI agents and data pipelines). 9-10: product plainly "
    "depends on fresh web data at scale (AI agents that browse/research, sales/"
    "market intelligence, diligence tools). 7-8: clear recurring web-data or "
    "agent-tooling needs. 4-6: plausible but peripheral. 1-3: little need for "
    "live web data."
)

VERIFY_PROCESSOR = "base"

# Structured output for sweep + per-event verification. Includes the fields
# each signal needs: investing partner (drives the intro path), founders,
# sector, numeric raise for thresholds, and the auto fit rating for net-new
# companies.
ROUND_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "rounds": {
            "type": "array",
            "description": "Qualifying funding rounds. Empty if none found.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "company": {"type": "string", "description": "Company name."},
                    "domain": {"type": "string", "description": "Company primary domain, e.g. acme.ai. NA if unknown."},
                    "round_stage": {"type": "string", "description": "Seed / Series A / Series B etc."},
                    "amount": {"type": "string", "description": "Round size with currency. NA if undisclosed."},
                    "amount_usd_millions": {"type": "number", "description": "Round size in USD millions as a number, 0 if undisclosed."},
                    "announced_date": {"type": "string", "description": "YYYY-MM-DD if known, else NA."},
                    "lead_investor": {"type": "string", "description": "Lead investor. NA if unknown."},
                    "co_investors": {"type": "string", "description": "Comma-separated other investors."},
                    "investing_partner": {"type": "string", "description": "The specific partner at the watched fund who led/joined the board for this deal (e.g. 'Jane Doe at Example Ventures'). NA if not publicly named."},
                    "founders": {"type": "string", "description": "Founder name(s) and role(s), comma-separated. NA if unknown."},
                    "sector": {"type": "string", "description": "Primary sector, e.g. AI infrastructure, Fintech, Healthcare."},
                    "is_ai_native": {"type": "string", "description": "yes/no — core product is AI model/infra/AI-first app."},
                    "one_liner": {"type": "string", "description": "One sentence: what the company does."},
                    "parallel_fit_rating": {"type": "number", "description": FIT_RUBRIC + " Answer with the integer rating."},
                    "fit_reasoning": {"type": "string", "description": "One sentence: why that fit rating."},
                },
                "required": [
                    "company", "domain", "round_stage", "amount", "amount_usd_millions",
                    "announced_date", "lead_investor", "co_investors", "investing_partner",
                    "founders", "sector", "is_ai_native", "one_liner",
                    "parallel_fit_rating", "fit_reasoning",
                ],
            },
        }
    },
    "required": ["rounds"],
}


def verify_input(detected: dict[str, Any]) -> str:
    """Input for the chained follow-up verification of one detected event."""
    return (
        "Verify this detected investment event. Confirm: (1) the named fund "
        f"actually participated in the round, (2) the round stage is {STAGES}, "
        f"(3) the company is AI-native ({AI_NATIVE_DEF}). Report the round only "
        "if all three hold with web evidence. Also identify the specific "
        "investing partner at the fund, the founders, and rate Parallel fit. "
        f"Event: {json.dumps(detected)}"
    )


# ------------------------------------------------------- trigger / priority ---
# Raise size + investor + fit rating, not every seed round. Weighted toward
# Seed/Series A — by Series B most prospects are locked into a stack ('rip and
# replace'), so the gems are earlier. ALL NUMBERS ARE TUNING KNOBS — tune them.
STAGE_WEIGHT = {"pre-seed": 40, "seed": 40, "series a": 35, "series b": 10}


def _stage_weight(stage: str) -> int:
    s = (stage or "").lower()
    for key, w in STAGE_WEIGHT.items():
        if key in s:
            return w
    return 15


def priority_for(stage: str, amount_usd_millions: float, fit_rating: float,
                 known_portco: bool) -> str:
    """Score a signal into high / medium / digest."""
    score = _stage_weight(stage)
    score += min(float(amount_usd_millions or 0), 50) * 0.6
    score += float(fit_rating or 0) * 3
    if not known_portco:
        score += 10
    if score >= 75:
        return "high"
    if score >= 50:
        return "medium"
    return "digest"


# --------------------------------------------------------- portco labeling ----
_PORTFOLIO_FILE = Path(__file__).resolve().parent / "portfolio_names.json"


def norm_company(name: str) -> str:
    n = name.lower().strip()
    n = re.sub(r"[.,']", "", n)
    n = re.sub(r"\s+(inc|llc|ltd|corp|co|ai)$", "", n)
    return re.sub(r"\s+", " ", n).strip()


def load_bundled_portfolio() -> dict[str, Any]:
    """Names-only known-companies list (derived from your CRM export; safe to bundle)."""
    try:
        return json.loads(_PORTFOLIO_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def is_known_portco(company: str, portfolio: dict[str, Any]) -> bool:
    return norm_company(company) in portfolio


def qualify_signal(
    r: dict[str, Any],
    fund: str,
    portfolio: dict[str, Any],
    base: dict[str, Any] | None = None,
    crm_match: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Turn a verified round into a fully-qualified signal — ONE implementation
    shared by the CLI drain (check.py), the local web drain, the weekly digest,
    and the webhook receiver, so none of them can drift.

    `crm_match` is the CRM lookup result (or None); callers fetch it in whatever
    way suits them (sync in scripts, `asyncio.to_thread` in async routes) and
    pass it in. Applies the known-vs-net-new flag (CRM wins over the local list),
    the pipeline label, the CRM deep link, and the priority score in lockstep."""
    from . import crm  # local import: keeps httpx/CRM deps out of import time

    company = r.get("company", "")
    known_local = is_known_portco(company, portfolio)
    in_pipeline = bool(crm_match["in_crm"]) if crm_match else known_local
    signal = {
        **r,
        **(base or {}),
        "fund_watched": fund,
        "known_portco": in_pipeline,
        "pipeline_label": crm.pipeline_label(crm_match, known_local),
        "crm_url": (crm_match or {}).get("url"),
        "priority": priority_for(
            r.get("round_stage", ""),
            r.get("amount_usd_millions", 0),
            r.get("parallel_fit_rating", 0),
            in_pipeline,
        ),
    }
    signal.setdefault("detected_via", "monitor")
    return signal


# --------------------------------------------------- async chained verification
async def averify_event(client: Any, detected: dict[str, Any], event_id: str) -> list[dict[str, Any]]:
    """Async flavor of the monitor→task chain (used by the serverless webhook):
    verify a detected event via a follow-up Task run chained with
    previous_interaction_id, returning qualified rounds with citations."""
    run = await client.task_run.create(
        input=verify_input(detected),
        processor=VERIFY_PROCESSOR,
        task_spec={"output_schema": {"type": "json", "json_schema": ROUND_SCHEMA}},
        previous_interaction_id=event_id,
        betas=[FIELD_BASIS_BETA],
    )
    result = await client.task_run.result(run.run_id, api_timeout=240, betas=[FIELD_BASIS_BETA])
    output = result.output
    content = output.content
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except json.JSONDecodeError:
            content = {}

    urls: list[str] = []
    for fb in (getattr(output, "basis", None) or []):
        for cit in (getattr(fb, "citations", None) or []):
            u = getattr(cit, "url", None)
            if u and u not in urls:
                urls.append(u)

    out = []
    for r in (content or {}).get("rounds", []):
        if str(r.get("is_ai_native", "")).lower() != "yes":
            continue
        out.append({**r, "sources": urls, "verify_run_id": run.run_id})
    return out


# ------------------------------------------------------------ event parsing ---
def parse_event_content(event: Any) -> dict[str, Any]:
    """Monitor structured output arrives as a JSON string in output.content."""
    output = getattr(event, "output", None)
    content = getattr(output, "content", None) if output else None
    if isinstance(content, str):
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return {"summary": content}
    return content or {}


def event_citations(event: Any) -> list[str]:
    urls: list[str] = []
    output = getattr(event, "output", None)
    for fb in (getattr(output, "basis", None) or []):
        for cit in (getattr(fb, "citations", None) or []):
            u = getattr(cit, "url", None)
            if u and u not in urls:
                urls.append(u)
    return urls


# ------------------------------------------------------------ slack delivery --
PRIORITY_EMOJI = {"high": "🚨", "medium": "🔔", "digest": "🗞"}

# The deployed app — Slack "Enrich →" buttons deep-link into it (?q= auto-runs
# the full cited brief, same as typing the company in the web app).
# Where "Enrich →" links point (the deployed web app). Set APP_URL in prod.
APP_URL = os.environ.get("APP_URL", "http://localhost:5173").rstrip("/")


def _na(v: Any) -> str | None:
    """None for missing/NA-ish values so sections can be skipped cleanly."""
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s.upper() != "NA" else None


def _signal_fact_lines(s: dict[str, Any]) -> list[str]:
    """The per-signal fields in the intended order. Lead investor sits right
    after the colon; other/follow-on investors go on a sub-bullet beneath."""
    lines: list[str] = []
    lead = _na(s.get("lead_investor")) or _na(s.get("fund_watched"))
    co = _na(s.get("co_investors")) or _na(s.get("investors"))
    if lead:
        inv = f"*Lead Investor(s):* {lead}"
        if co:
            inv += f"\n        ◦ Also in round: {co}"
        lines.append(inv)
    elif co:
        lines.append(f"*Investors:* {co}")
    if _na(s.get("sector")):
        lines.append(f"*Sector:* {s['sector']}")
    if _na(s.get("announced_date")):
        lines.append(f"*Funding as of:* {s['announced_date']}")
    pipeline = s.get("pipeline_label") or ("On your known-companies list" if s.get("known_portco") else "Not in Pipeline")
    # In-pipeline companies deep-link to their CRM record for one-click access.
    if s.get("crm_url"):
        pipeline = f"<{s['crm_url']}|{pipeline}>"
    lines.append(f"*Pipeline:* {pipeline}")
    # Fit = use-case description only; the numeric rating stays internal.
    if _na(s.get("fit_reasoning")):
        lines.append(f"*Fit:* {s['fit_reasoning']}")
    if _na(s.get("founders")):
        lines.append(f"*Founders:* {s['founders']}")
    if _na(s.get("investing_partner")):
        lines.append(f"*Intro Path:* {s['investing_partner']}")
    return lines


def build_signal_blocks(s: dict[str, Any]) -> list[dict[str, Any]]:
    """One verified signal -> Block Kit blocks, in the specified
    format (2026-07-09): header; Company Description (+ website/press links);
    Lead Investor(s) / Sector / Funding as of / Pipeline / Fit; Founders;
    Intro Path; an Enrich button into the web app; numbered sources."""
    emoji = PRIORITY_EMOJI.get(s.get("priority", "medium"), "🔔")
    title = f"{emoji} {s.get('company', '?')} — {s.get('round_stage', '?')}"
    if _na(s.get("amount")):
        title += f", {s['amount']}"

    blocks: list[dict[str, Any]] = [
        {"type": "header", "text": {"type": "plain_text", "emoji": True, "text": title[:140]}},
    ]

    # Company Description — what it does (category/fit come separately, per
    # design note: description routes understanding, category routes reps).
    desc = _na(s.get("one_liner")) or _na(s.get("summary"))
    if desc:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*Company Description:* {desc[:2800]}"}})

    # Double-click links: company site + press (first source), by design.
    links = []
    domain = _na(s.get("domain"))
    if domain:
        links.append(f"<https://{domain}|{domain}>")
    first_source = next(iter(s.get("sources") or []), None)
    if first_source:
        links.append(f"<{first_source}|press coverage>")
    if links:
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": "🔗 " + "   •   ".join(links)}]})

    # The core facts, in the requested order — lead investor right after the
    # colon with follow-on investors as a sub-bullet, and a blank line between
    # every section (formatting rules).
    facts = _signal_fact_lines(s)
    if facts:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "\n\n".join(facts)[:2900]}})

    # Enrich → the web app runs the full cited brief for this company.
    q = domain or s.get("company", "")
    blocks.append({
        "type": "actions",
        "elements": [{
            "type": "button",
            "text": {"type": "plain_text", "emoji": True, "text": "Enrich → full cited brief"},
            "url": f"{APP_URL}/?q={q}",
        }],
    })

    sources = (s.get("sources") or [])[:5]
    if sources:
        src_links = "   ".join(f"<{u}|[{i + 1}]>" for i, u in enumerate(sources))
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": f"📎 *Sources:*   {src_links}"}]})
    return blocks


def build_weekly_header_blocks(week_label: str, signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The Monday-recap headline message; per-signal detail goes in the thread."""
    new = sum(1 for s in signals if not s.get("known_portco"))
    high = sum(1 for s in signals if s.get("priority") == "high")
    funds = sorted({s.get("fund_watched", "") for s in signals if s.get("fund_watched")})
    lines = [
        f"*{len(signals)}* AI-native seed–Series B rounds from our investors last week"
        f" — *{new}* not in pipeline, *{high}* high-priority.",
    ]
    if funds:
        lines.append(f"Funds active: {', '.join(funds)}")
    return [
        {"type": "header", "text": {"type": "plain_text", "emoji": True,
                                    "text": f"📡 Week of {week_label} — Investor Signals + GTM Action"[:140]}},
        {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)[:2900]}},
    ]


def build_digest_blocks(signals: list[dict[str, Any]], title: str) -> list[dict[str, Any]]:
    """Digest-priority signals roll into one compact message."""
    lines = []
    for s in signals:
        badge = "NEW" if not s.get("known_portco") else "known"
        lines.append(
            f"• *{s.get('company')}* — {s.get('round_stage')}, {s.get('amount', '?')}"
            f" ({s.get('fund_watched')}) [{badge}]"
        )
    return [
        {"type": "header", "text": {"type": "plain_text", "emoji": True, "text": f"🗞 {title}"[:140]}},
        {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)[:2900]}},
    ]


def slack_enabled() -> bool:
    return bool(os.environ.get("SLACK_WEBHOOK_URL"))


def post_to_slack(blocks: list[dict[str, Any]], text: str) -> bool:
    """Sync post (monitor/ scripts). No-ops without SLACK_WEBHOOK_URL —
    a thin Block Kit poster. Returns True if posted."""
    url = os.environ.get("SLACK_WEBHOOK_URL")
    if not url:
        return False
    resp = httpx.post(url, json={"text": text, "blocks": blocks}, timeout=15.0)
    resp.raise_for_status()
    return True


async def apost_to_slack(blocks: list[dict[str, Any]], text: str) -> bool:
    """Async post (FastAPI webhook route)."""
    url = os.environ.get("SLACK_WEBHOOK_URL")
    if not url:
        return False
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, json={"text": text, "blocks": blocks})
        resp.raise_for_status()
    return True


# ------------------------------------------------ weekly single-message digest
def _compact_signal_text(s: dict[str, Any]) -> str:
    """One startup as a single mrkdwn segment for the combined weekly message:
    title, description, the fact lines (blank line between sections), and the
    double-click links."""
    emoji = PRIORITY_EMOJI.get(s.get("priority", "medium"), "🔔")
    title = f"{emoji} *{s.get('company', '?')} — {s.get('round_stage', '?')}"
    if _na(s.get("amount")):
        title += f", {s['amount']}"
    title += "*"

    parts = [title]
    desc = _na(s.get("one_liner")) or _na(s.get("summary"))
    if desc:
        parts.append(f"*Company Description:* {desc}")
    parts.extend(_signal_fact_lines(s))

    links = []
    domain = _na(s.get("domain"))
    if domain:
        links.append(f"<https://{domain}|{domain}>")
    first_source = next(iter(s.get("sources") or []), None)
    if first_source:
        links.append(f"<{first_source}|press coverage>")
    links.append(f"<{APP_URL}/?q={domain or s.get('company', '')}|Enrich → full cited brief>")
    parts.append("🔗 " + "   •   ".join(links))
    return "\n\n".join(parts)[:2950]


def post_weekly_digest_sync(week_label: str, signals: list[dict[str, Any]]) -> dict[str, Any]:
    """The Monday recap, by design: ONE message — headline plus
    every startup that raised last week, dividers between them."""
    if not slack_enabled():
        return {"mode": "disabled", "posted": 0}

    blocks = build_weekly_header_blocks(week_label, signals)
    for s in signals:
        blocks.append({"type": "divider"})
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": _compact_signal_text(s)}})

    # Slack caps a message at 50 blocks — chunk in the (rare) monster week.
    text = f"Week of {week_label} — Investor Signals + GTM Action"
    posted = 0
    for i in range(0, len(blocks), 48):
        if post_to_slack(blocks[i:i + 48], text if i == 0 else f"{text} (cont.)"):
            posted += 1
    return {"mode": "single-message", "posted": posted, "signals": len(signals)}


def notify_signals_sync(signals: list[dict[str, Any]], digest_title: str = "Investor signals digest") -> int:
    """Route signals per priority: high/medium -> individual posts, digest ->
    one rollup. Returns number of Slack messages sent (0 if Slack disabled)."""
    if not slack_enabled() or not signals:
        return 0
    sent = 0
    ping = [s for s in signals if s.get("priority") in ("high", "medium")]
    digest = [s for s in signals if s.get("priority") not in ("high", "medium")]
    for s in ping:
        if post_to_slack(build_signal_blocks(s), f"{s.get('company')} — {s.get('round_stage')}"):
            sent += 1
    if digest:
        if post_to_slack(build_digest_blocks(digest, digest_title), digest_title):
            sent += 1
    return sent
