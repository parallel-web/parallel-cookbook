"""
parallel_client.py — the ONE file that reads PARALLEL_API_KEY and talks to the
Parallel Task API. Nothing else in the app touches the key or the SDK.

================================================================================
WHAT THIS DOES
================================================================================
For every company we run TWO (optionally THREE) concurrent Task API runs and
merge them into one cited `ResearchBrief`:

  1. ACCOUNT run  — firmographics, funding/financials, technographics, buying
                    signals. One structured JSON output schema.
  2. CONTACTS run — a list of senior decision-makers at that company, each with
                    their own per-element citations.
  3. CUSTOM run   — OPTIONAL. The rep's ad-hoc questions (Clay-style custom
                    columns), answered via ONE fixed generic `answers` array
                    schema (_CUSTOM_SCHEMA). The questions live in the input
                    prompt, not the schema, so the schema never changes as the
                    questions do. Each answer carries its own per-element
                    citations, same as contacts. Runs only when custom fields
                    are requested; its failure never hard-fails the lookup.

Endpoint / SDK surface (verified against the installed `parallel-web` v1.1.0
and https://docs.parallel.ai):
  * client.task_run.create(...)  -> creates a run, returns immediately (run_id)
  * client.task_run.result(run_id, api_timeout=...) -> long-polls until done
  We use the ASYNC client (AsyncParallel) so the two runs, and bulk rows, run
  concurrently with asyncio.gather.

Output schema type: {"type": "json", "json_schema": {...}} — structured
enrichment with typed fields. Each TOP-LEVEL field of the schema comes back
with its own FieldBasis in `result.output.basis`: citations (url + excerpts),
reasoning, and confidence (high|medium|low|null). That per-field basis IS the
demo — it's the proof behind every claim.

Per-array-element citations (so each CONTACT carries its own sources) require
the beta header:  parallel-beta: field-basis-2025-11-25
which we pass via the SDK's `betas=[...]` kwarg on BOTH create() and result().
With it, an array field `contacts` also emits `contacts.0`, `contacts.1`, ...
FieldBasis entries (pydash-style dot notation). If Parallel ever stops
honoring the beta, we degrade gracefully to the group-level `contacts` basis
(see _basis_for_contact).

================================================================================
SAFE TO TWEAK
================================================================================
  * PROCESSOR TIER — the `depth` argument ("fast" -> core-fast, "deep" ->
    pro-fast). Bump to a deeper tier for richer results at the cost of latency.
    Any valid tier name works (lite/base/core/pro/ultra + optional -fast).
  * THE INPUT QUERY STRING — the company name/domain the rep types, and the
    natural-language framing in _ACCOUNT_INPUT / _CONTACTS_INPUT. Reword freely.
  * api_timeout values in _DEPTH_CONFIG — how long we'll wait for a result.

DO NOT TWEAK (these are load-bearing / break the contract):
  * The two OUTPUT JSON SCHEMAS (_ACCOUNT_SCHEMA / _CONTACTS_SCHEMA). The
    frontend and to_research_brief() map field names one-to-one; renaming a
    field silently drops it from the UI.
  * The BETA HEADER value (_FIELD_BASIS_BETA). It's the exact dated string the
    API expects; a typo disables per-contact citations.
  * to_research_brief()'s output shape — it is the API contract.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# --- Load the API key from the repo-root .env (one level ABOVE project/) ------
# backend/parallel_client.py -> parents[0]=backend, [1]=project, [2]=repo root
_ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(_ROOT_ENV)

from parallel import (  # noqa: E402
    APITimeoutError,
    AsyncParallel,  # noqa: E402  (import after load_dotenv)
    AuthenticationError,
    PermissionDeniedError,
    RateLimitError,
)

# The exact beta header value that unlocks per-array-element (per-contact)
# citations. Verified against parallel-web v1.1.0 + the research-basis docs.
_FIELD_BASIS_BETA = "field-basis-2025-11-25"

# depth -> (processor, api_timeout_seconds). core-fast/pro-fast keep single
# lookups snappy enough for a live demo while still doing real web research.
_DEPTH_CONFIG: dict[str, tuple[str, int]] = {
    "fast": ("core-fast", 150),
    "deep": ("pro-fast", 330),
}
_DEFAULT_DEPTH = "fast"

# Confidence values we accept straight from the API. Anything else -> None.
_VALID_CONFIDENCE = {"high", "medium", "low"}


class ParallelConfigError(RuntimeError):
    """Raised when the server is misconfigured (e.g. missing API key)."""


class ParallelCallError(RuntimeError):
    """
    Raised when a Parallel API call fails. Carries an HTTP-ish status hint and a
    human-friendly message the route layer can surface to the browser.
    """

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def api_key_loaded() -> bool:
    """True iff PARALLEL_API_KEY is present. Never returns/logs the key itself."""
    return bool(os.environ.get("PARALLEL_API_KEY"))


def _client() -> AsyncParallel:
    key = os.environ.get("PARALLEL_API_KEY")
    if not key:
        raise ParallelConfigError(
            "PARALLEL_API_KEY is not set on the server. Add it to the repo-root "
            ".env and restart the backend."
        )
    # Generous client-side timeout so the SDK doesn't cut off our long-poll
    # before the server-side api_timeout does.
    return AsyncParallel(api_key=key, timeout=600.0)


# ==============================================================================
# OUTPUT SCHEMAS  (DO NOT rename fields live — they map 1:1 to the contract)
# ==============================================================================
# Flat top-level fields => one FieldBasis (citations + confidence) PER FIELD.
# We reassemble them into the nested firmographics/funding/technographics groups
# in to_research_brief(). All properties are listed in `required` because the
# Task API expects strict schemas; when the web has no answer the model returns
# an empty value AND emits no citation — we then null the field (never fabricate).
_ACCOUNT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "company_name": {"type": "string", "description": "Official company name."},
        "domain": {"type": "string", "description": "Primary website domain, e.g. ramp.com (no protocol)."},
        "industry": {"type": "string", "description": "Primary industry / sector."},
        "headquarters": {"type": "string", "description": "Headquarters city, state, country."},
        "employee_count": {"type": "string", "description": "Approximate current employee headcount or range."},
        "founded_year": {"type": "string", "description": "Year the company was founded."},
        "description": {"type": "string", "description": "One-to-two sentence description of what the company does."},
        "total_raised": {"type": "string", "description": "Total funding raised to date, with currency."},
        "last_round": {"type": "string", "description": "Most recent funding round: stage, amount, and date."},
        "investors": {"type": "array", "items": {"type": "string"}, "description": "Notable investors / lead investors."},
        "valuation": {"type": "string", "description": "Most recent known valuation, with date if available."},
        "revenue_estimate": {"type": "string", "description": "Estimated annual revenue or ARR, if publicly reported."},
        "tech_stack": {"type": "array", "items": {"type": "string"}, "description": "Notable technologies, tools, or platforms the company is known to use. Prefer BuiltWith (builtwith.com) for the company's domain as the source; supplement with the company's own site, job posts, and engineering blog."},
        "buying_signals": {
            "type": "array",
            "description": "Recent events that suggest sales timing: funding, hiring surges, product launches, exec hires, expansion.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "headline": {"type": "string", "description": "Short headline of the signal."},
                    "type": {"type": "string", "description": "Signal category, e.g. funding, hiring, product, leadership, expansion."},
                    "date": {"type": "string", "description": "Date of the signal (YYYY-MM or YYYY-MM-DD) if known, else empty."},
                },
                "required": ["headline", "type", "date"],
            },
        },
    },
    "required": [
        "company_name", "domain", "industry", "headquarters", "employee_count",
        "founded_year", "description", "total_raised", "last_round", "investors",
        "valuation", "revenue_estimate", "tech_stack", "buying_signals",
    ],
}

_CONTACTS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "contacts": {
            "type": "array",
            "description": "Up to 5 senior decision-makers / likely buyers at the company.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string", "description": "Full name."},
                    "title": {"type": "string", "description": "Current job title at this company."},
                    "seniority": {"type": "string", "description": "Seniority band, e.g. C-Suite, VP, Director, Manager."},
                    "linkedin_url": {"type": "string", "description": "LinkedIn profile URL if publicly known, else empty."},
                    "contact_methods": {
                        "type": "array",
                        "description": (
                            "Up to 3 total verifiable contact methods (work emails "
                            "and/or phone numbers) for this person, ordered from "
                            "highest to lowest confidence. Prefer results sourced "
                            "from ZoomInfo, RocketReach, or another verified "
                            "contact-data database; never guess or fabricate."
                        ),
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "type": {"type": "string", "description": "Either 'email' or 'phone'."},
                                "value": {"type": "string", "description": "The email address or phone number."},
                            },
                            "required": ["type", "value"],
                        },
                    },
                },
                "required": ["name", "title", "seniority", "linkedin_url", "contact_methods"],
            },
        }
    },
    "required": ["contacts"],
}

# CUSTOM RESEARCH FIELDS schema — ONE fixed, generic schema shared by every
# custom run, regardless of what the rep asks. The rapidly-changing part (the
# questions themselves) lives entirely in the natural-language input, NOT here,
# so this schema never needs to be rebuilt as requirements change.
#
# `answers` is an ARRAY, so — exactly like `contacts` — each element gets its
# own per-element FieldBasis (`answers.0`, `answers.1`, ...) under the
# field-basis beta. That's how each answer carries its own citations. Each item
# echoes the `question` verbatim so we can realign answers to the requested
# fields even if the model reorders or drops one.
_CUSTOM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "answers": {
            "type": "array",
            "description": "One entry per requested question, in the same order they were asked.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "question": {"type": "string", "description": "The question being answered, copied verbatim."},
                    "answer": {"type": "string", "description": "The answer, ONLY if supported by a citable web source; otherwise empty. Never guess."},
                },
                "required": ["question", "answer"],
            },
        }
    },
    "required": ["answers"],
}

# Natural-language framing for each run. SAFE to reword live.
def _account_input(query: str) -> str:
    return (
        f'Research the company "{query}". Provide firmographics, funding and '
        f"financials, technology stack, and recent buying signals (funding, "
        f"hiring, product launches, leadership changes, expansion). Where they "
        f"help, draw on business-data sources such as ZoomInfo and RocketReach "
        f"alongside the company's own site, filings, and reputable press. For "
        f"the technology stack specifically, check BuiltWith (builtwith.com) for "
        f"the company's domain as the preferred technographics source. Only "
        f"report facts you can support with a web source."
    )


def _contacts_input(query: str) -> str:
    return (
        f'Identify up to 5 senior go-to-market and executive decision-makers at '
        f'the company "{query}" — e.g. CEO, founders, CRO/VP Sales, VP/CMO '
        f"Marketing, Head of Revenue or Growth. Begin by preferring contact-data "
        f"sources such as RocketReach and ZoomInfo. You may also include contacts "
        f"drawn from other sources (e.g. LinkedIn, the company's own site, press), "
        f"but only when your confidence in them is higher than 'medium'. For each, "
        f"give name, current title, seniority band, and LinkedIn URL. For contact "
        f"methods, prefer information sourced from ZoomInfo, RocketReach, or "
        f"another verified contact-data database over other sources. List each "
        f"verifiable work email address and phone number for the person, ordered "
        f"from highest to lowest confidence, capped to 3 total contact methods per "
        f"person. Never invent an email address or phone number."
    )


def _custom_input(query: str, defs: list[dict[str, Any]]) -> str:
    """
    Framing for the CUSTOM run. This is where the rep's rapidly-changing
    questions live (the schema stays fixed). SAFE to reword live.
    """
    questions = "\n".join(f"{i + 1}. {d.get('question', '').strip()}" for i, d in enumerate(defs))
    return (
        f'Answer the following questions about the company "{query}". Return one '
        f"entry in `answers` for EACH question, in the same order, copying the "
        f"question text verbatim into the `question` field. Provide an `answer` "
        f"ONLY if you can support it with a citable web source; if you cannot find "
        f"a sourced answer, leave `answer` empty rather than guessing. Never "
        f"fabricate.\n\n{questions}"
    )


# ==============================================================================
# LOW-LEVEL: run one task (create -> result) with the field-basis beta
# ==============================================================================
async def _run_task(
    client: AsyncParallel,
    *,
    input_text: str,
    output_schema: dict[str, Any],
    processor: str,
    api_timeout: int,
) -> tuple[dict[str, Any], list[Any], str]:
    """
    Returns (parsed_content_dict, basis_list, run_id).

    Wraps Parallel SDK errors in ParallelCallError with a friendly message +
    status hint so the route layer can translate them for the browser. We log
    only the status/short reason — never the payload or the key.
    """
    import json

    try:
        run = await client.task_run.create(
            input=input_text,
            processor=processor,
            task_spec={"output_schema": {"type": "json", "json_schema": output_schema}},
            betas=[_FIELD_BASIS_BETA],
        )
        result = await client.task_run.result(
            run.run_id,
            api_timeout=api_timeout,
            betas=[_FIELD_BASIS_BETA],
        )
    except AuthenticationError:
        raise ParallelCallError(401, "Parallel rejected the API key (401). Check PARALLEL_API_KEY on the server.") from None
    except PermissionDeniedError:
        raise ParallelCallError(
            403,
            "Parallel returned 403 — this usually means the account is out of "
            "balance. Add balance in the Parallel dashboard and retry.",
        ) from None
    except RateLimitError:
        raise ParallelCallError(429, "Parallel rate limit hit (429). Wait a moment and retry.") from None
    except APITimeoutError:
        raise ParallelCallError(504, "The Parallel research run timed out. Try again or switch to Fast depth.") from None
    except Exception as exc:  # noqa: BLE001 — normalize any other SDK/transport error
        # Keep the log actionable but never leak secrets.
        print(f"[parallel_client] task run failed on processor={processor}: {type(exc).__name__}: {exc}")
        raise ParallelCallError(502, "The Parallel research run failed. Please retry.") from exc

    output = getattr(result, "output", None)
    if output is None:
        raise ParallelCallError(502, "Parallel returned no output for this run.")

    # output.content is a JSON-encoded string for a JSON output schema.
    try:
        content = json.loads(output.content) if isinstance(output.content, str) else (output.content or {})
    except (json.JSONDecodeError, TypeError):
        content = {}

    basis = list(getattr(output, "basis", None) or [])
    return content, basis, run.run_id


# ==============================================================================
# NORMALIZATION HELPERS  ->  the Field<T> shape
# ==============================================================================
def _index_basis(basis: list[Any]) -> dict[str, Any]:
    """Map basis list -> {field_name: FieldBasis} for O(1) lookup."""
    out: dict[str, Any] = {}
    for fb in basis:
        name = getattr(fb, "field", None)
        if name is not None:
            out[name] = fb
    return out


def _citations_from(fb: Any) -> list[dict[str, Any]]:
    """FieldBasis -> [{url, excerpts}] in contract shape (drops nothing)."""
    if fb is None:
        return []
    cits = getattr(fb, "citations", None) or []
    result: list[dict[str, Any]] = []
    for c in cits:
        url = getattr(c, "url", None)
        if not url:
            continue
        excerpts = getattr(c, "excerpts", None) or []
        result.append({"url": url, "excerpts": list(excerpts)})
    return result


def _confidence_from(fb: Any) -> str | None:
    if fb is None:
        return None
    conf = getattr(fb, "confidence", None)
    if not conf:
        return None
    conf = str(conf).strip().lower()
    return conf if conf in _VALID_CONFIDENCE else None


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        v = value.strip().lower()
        return v == "" or v in {"n/a", "na", "unknown", "none", "not available", "not found"}
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def _field(value: Any, fb: Any) -> dict[str, Any]:
    """
    Build a Field<T>. THE CREDIBILITY RULE: a value survives only if it is
    non-empty AND backed by at least one citation. Otherwise we return a fully
    null field — we never surface an uncited claim as fact.
    """
    citations = _citations_from(fb)
    if _is_empty(value) or not citations:
        return {"value": None, "confidence": None, "citations": []}
    return {"value": value, "confidence": _confidence_from(fb), "citations": citations}


def _null_field() -> dict[str, Any]:
    return {"value": None, "confidence": None, "citations": []}


def _array_field(name: str, value: Any, bmap: dict[str, Any]) -> dict[str, Any]:
    """
    Field<T> for an ARRAY output field. With the field-basis beta, citations for
    an array often live on the per-element entries (`tech_stack.0`, `investors.1`,
    `buying_signals.0`, ...) rather than on the top-level field. We aggregate the
    top-level basis plus every `<name>.<i>` element basis so array fields don't
    look uncited when they actually are. Same credibility rule applies: no
    citations anywhere -> null the field.
    """
    top = bmap.get(name)
    citations = _citations_from(top)
    confidence = _confidence_from(top)
    seen = {c["url"] for c in citations}

    i = 0
    while True:
        fb = bmap.get(f"{name}.{i}")
        if fb is None:
            break
        for c in _citations_from(fb):
            if c["url"] not in seen:
                citations.append(c)
                seen.add(c["url"])
        if confidence is None:
            confidence = _confidence_from(fb)
        i += 1

    if _is_empty(value) or not citations:
        return {"value": None, "confidence": None, "citations": []}
    return {"value": value, "confidence": confidence, "citations": citations}


def _basis_for_contact(idx: int, bmap: dict[str, Any]) -> Any:
    """
    Per-element basis is `contacts.<idx>` when the field-basis beta is honored.
    Fall back to the group-level `contacts` basis if the per-element entry is
    absent (graceful degradation).
    """
    return bmap.get(f"contacts.{idx}") or bmap.get("contacts")


def _normalize_q(s: Any) -> str:
    """Whitespace/case-insensitive form of a question, for matching."""
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def _match_answers_to_defs(
    defs: list[dict[str, Any]], answers: list[Any], bmap: dict[str, Any]
) -> list[tuple[str | None, Any]]:
    """
    Realign the model's `answers` array to the requested defs. Returns a list
    parallel to `defs` of (answer_value, element_basis). Matches primarily by
    the echoed `question` text (robust to reordering/dropping), falling back to
    positional order. A def with no matching answer gets (None, None) so it
    nulls out downstream — honest, never mis-attributed. Element basis is the
    per-element `answers.<i>` entry (with graceful fallback to the group basis).
    """
    by_q: dict[str, int] = {}
    for i, a in enumerate(answers):
        if isinstance(a, dict):
            q = _normalize_q(a.get("question"))
            if q and q not in by_q:
                by_q[q] = i

    used: set = set()
    out: list[tuple[str | None, Any]] = []
    for i, d in enumerate(defs):
        dq = _normalize_q(d.get("question"))
        idx: int | None = None
        if dq and dq in by_q and by_q[dq] not in used:
            idx = by_q[dq]
        elif i < len(answers) and i not in used and isinstance(answers[i], dict):
            idx = i  # positional fallback
        if idx is None:
            out.append((None, None))
            continue
        used.add(idx)
        ans = answers[idx]
        value = ans.get("answer") if isinstance(ans, dict) else None
        fb = bmap.get(f"answers.{idx}") or bmap.get("answers")
        out.append((value, fb))
    return out


def _capped_contact_methods(raw: Any) -> list[dict[str, str]] | None:
    """Defense-in-depth: enforce the schema's own cap even if the model
    over-returns, and drop malformed entries. Order (confidence, highest
    first) is preserved as given by the model."""
    if not isinstance(raw, list):
        return None
    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        t, v = item.get("type"), item.get("value")
        if t in ("email", "phone") and isinstance(v, str) and v.strip():
            out.append({"type": t, "value": v.strip()})
        if len(out) == 3:
            break
    return out


_EMAIL_SAFE = re.compile(r"[^a-z]")


def _infer_email(name: str | None, domain: str | None) -> dict[str, Any]:
    """
    Always-inferred email: first.last@domain. Marked confidence 'inferred' with
    NO citations. This is a pattern guess, never claimed as verified.
    """
    if not name or not domain:
        return {"value": None, "confidence": "inferred", "citations": []}
    parts = [p for p in name.strip().split() if p]
    if len(parts) < 2:
        return {"value": None, "confidence": "inferred", "citations": []}
    first = _EMAIL_SAFE.sub("", parts[0].lower())
    last = _EMAIL_SAFE.sub("", parts[-1].lower())
    clean_domain = domain.strip().lower().replace("https://", "").replace("http://", "").strip("/")
    clean_domain = clean_domain.split("/")[0]
    if not first or not last or not clean_domain:
        return {"value": None, "confidence": "inferred", "citations": []}
    return {"value": f"{first}.{last}@{clean_domain}", "confidence": "inferred", "citations": []}


_DOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$")


def _normalize_domain(value: str) -> str | None:
    """Strip protocol/path/whitespace to a bare host, lowercased."""
    host = value.strip().lower().replace("https://", "").replace("http://", "")
    host = host.split("/")[0].strip("/").strip()
    return host or None


def _looks_like_domain(value: str) -> bool:
    """A user-supplied query that is itself a domain (e.g. 'ramp.com') — trusted
    input, unlike a model-produced domain, which must carry a citation."""
    host = _normalize_domain(value)
    return bool(host) and bool(_DOMAIN_RE.match(host))


# ==============================================================================
# PUBLIC API
# ==============================================================================
async def enrich_account(query: str, depth: str = _DEFAULT_DEPTH) -> dict[str, Any]:
    """Run the ACCOUNT task. Returns {content, basis, run_id, processor}."""
    processor, api_timeout = _DEPTH_CONFIG.get(depth, _DEPTH_CONFIG[_DEFAULT_DEPTH])
    client = _client()
    try:
        content, basis, run_id = await _run_task(
            client,
            input_text=_account_input(query),
            output_schema=_ACCOUNT_SCHEMA,
            processor=processor,
            api_timeout=api_timeout,
        )
    finally:
        await client.close()
    return {"content": content, "basis": basis, "run_id": run_id, "processor": processor}


async def enrich_contacts(query: str, depth: str = _DEFAULT_DEPTH) -> dict[str, Any]:
    """Run the CONTACTS task. Returns {content, basis, run_id, processor}."""
    processor, api_timeout = _DEPTH_CONFIG.get(depth, _DEPTH_CONFIG[_DEFAULT_DEPTH])
    client = _client()
    try:
        content, basis, run_id = await _run_task(
            client,
            input_text=_contacts_input(query),
            output_schema=_CONTACTS_SCHEMA,
            processor=processor,
            api_timeout=api_timeout,
        )
    finally:
        await client.close()
    return {"content": content, "basis": basis, "run_id": run_id, "processor": processor}


async def enrich_custom(
    query: str, defs: list[dict[str, Any]], depth: str = _DEFAULT_DEPTH
) -> dict[str, Any]:
    """Run the CUSTOM task for the rep's ad-hoc questions. Returns
    {content, basis, run_id, processor, defs}. `defs` is carried through so
    to_research_brief() can realign answers to the requested fields."""
    processor, api_timeout = _DEPTH_CONFIG.get(depth, _DEPTH_CONFIG[_DEFAULT_DEPTH])
    client = _client()
    try:
        content, basis, run_id = await _run_task(
            client,
            input_text=_custom_input(query, defs),
            output_schema=_CUSTOM_SCHEMA,
            processor=processor,
            api_timeout=api_timeout,
        )
    finally:
        await client.close()
    return {"content": content, "basis": basis, "run_id": run_id, "processor": processor, "defs": defs}


def _build_custom_fields(custom_result: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Turn a raw custom run into the contract's custom_fields list. Each answer
    passes the same credibility gate (_field) as every native field, so an
    uncited answer nulls out. Shared by to_research_brief() and the custom-only
    endpoint."""
    if custom_result is None:
        return []
    cus_content: dict[str, Any] = custom_result.get("content") or {}
    cus_basis = _index_basis(custom_result.get("basis") or [])
    defs = custom_result.get("defs") or []
    raw_answers = cus_content.get("answers")
    answers = raw_answers if isinstance(raw_answers, list) else []
    matched = _match_answers_to_defs(defs, answers, cus_basis)
    out: list[dict[str, Any]] = []
    for d, (value, fb) in zip(defs, matched, strict=True):
        out.append(
            {
                "key": d.get("key"),
                "label": d.get("label"),
                "question": d.get("question"),
                "field": _field(value, fb),
            }
        )
    return out


async def enrich_custom_only(
    query: str,
    depth: str = _DEFAULT_DEPTH,
    custom_defs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Research ONLY the custom fields — a single Task run, no account/contacts.
    Used to append answers to an already-loaded brief without re-researching the
    whole company. Returns {custom_fields, run_ids}."""
    custom_defs = custom_defs or []
    if not custom_defs:
        return {"custom_fields": [], "run_ids": []}
    custom_res = await enrich_custom(query, custom_defs, depth)
    return {
        "custom_fields": _build_custom_fields(custom_res),
        "run_ids": [custom_res["run_id"]],
    }


def to_research_brief(
    query: str,
    account_result: dict[str, Any] | None,
    contacts_result: dict[str, Any] | None,
    meta: dict[str, Any],
    custom_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Merge the raw Parallel results into the exact ResearchBrief contract.
    Tolerant of a missing/failed section: whatever we couldn't get is nulled and
    meta.partial is set true (never raises on partial data). `custom_result` is
    optional and additive — absent -> custom_fields is [].
    """
    partial = bool(meta.get("partial", False))

    # ---- ACCOUNT ----
    acc_content: dict[str, Any] = (account_result or {}).get("content") or {}
    acc_basis = _index_basis((account_result or {}).get("basis") or [])
    if account_result is None:
        partial = True

    def af(name: str) -> dict[str, Any]:
        return _field(acc_content.get(name), acc_basis.get(name))

    _cn = acc_content.get("company_name")
    company_name = _cn if isinstance(_cn, str) and not _is_empty(_cn) else query
    # domain is a plain string in the contract, but it feeds the company website
    # AND email synthesis, so ONE uncited domain would amplify into several
    # actionable-looking (but ungrounded) values. Apply the same credibility rule
    # as every other field: trust it only if the user typed a domain (their own
    # input, not model output) or the researched domain carries a citation.
    raw_domain = acc_content.get("domain")
    domain = None
    if isinstance(query, str) and _looks_like_domain(query):
        domain = _normalize_domain(query)
    elif (
        isinstance(raw_domain, str)
        and not _is_empty(raw_domain)
        and _citations_from(acc_basis.get("domain"))
    ):
        domain = _normalize_domain(raw_domain)

    firmographics = {
        "industry": af("industry"),
        "hq": af("headquarters"),
        "employee_count": af("employee_count"),
        "founded_year": af("founded_year"),
        "description": af("description"),
    }
    funding = {
        "total_raised": af("total_raised"),
        "last_round": af("last_round"),
        "investors": _array_field("investors", acc_content.get("investors"), acc_basis),
        "valuation": af("valuation"),
        "revenue_estimate": af("revenue_estimate"),
    }
    technographics = {"tech_stack": _array_field("tech_stack", acc_content.get("tech_stack"), acc_basis)}
    buying_signals = _array_field("buying_signals", acc_content.get("buying_signals"), acc_basis)

    # ---- CONTACTS ----
    con_content: dict[str, Any] = (contacts_result or {}).get("content") or {}
    con_basis = _index_basis((contacts_result or {}).get("basis") or [])
    if contacts_result is None:
        partial = True

    contacts: list[dict[str, Any]] = []
    for i, raw in enumerate(con_content.get("contacts") or []):
        if not isinstance(raw, dict):
            continue
        fb = _basis_for_contact(i, con_basis)
        # All web-sourced sub-fields share this contact's element-level basis
        # (per-field basis inside an array element isn't emitted). inferred_email
        # is always pattern-derived and carries no citation.
        name_val = raw.get("name")
        contacts.append(
            {
                "name": _field(name_val, fb),
                "title": _field(raw.get("title"), fb),
                "seniority": _field(raw.get("seniority"), fb),
                "linkedin_url": _field(raw.get("linkedin_url"), fb),
                "contact_methods": _field(_capped_contact_methods(raw.get("contact_methods")), fb),
                "inferred_email": _infer_email(name_val if isinstance(name_val, str) else None, domain),
            }
        )

    # ---- CUSTOM FIELDS ----
    # Additive: absent -> []. Each answer flows through the same credibility gate
    # (_field) as every native field, so an uncited answer nulls out.
    custom_fields = _build_custom_fields(custom_result)

    return {
        "query": query,
        "company_name": company_name,
        "domain": domain,
        "firmographics": firmographics,
        "funding": funding,
        "technographics": technographics,
        "buying_signals": buying_signals,
        "contacts": contacts,
        "custom_fields": custom_fields,
        "meta": {
            "processor": meta.get("processor", ""),
            "run_ids": meta.get("run_ids", []),
            "latency_ms": meta.get("latency_ms", 0),
            "partial": partial,
        },
    }


async def enrich(
    query: str,
    depth: str = _DEFAULT_DEPTH,
    custom_defs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Top-level single-company enrichment: run account + contacts CONCURRENTLY
    (plus an optional custom-fields run) and merge into one ResearchBrief.
    Per-section failures are isolated so one weak run still yields a partial
    (but honest) brief. If BOTH the account AND contacts runs fail, re-raise the
    account error so the route returns a clean error to the client. The custom
    run is purely additive — its failure never hard-fails the lookup.
    """
    custom_defs = custom_defs or []
    processor = _DEPTH_CONFIG.get(depth, _DEPTH_CONFIG[_DEFAULT_DEPTH])[0]
    started = time.perf_counter()

    coros = [enrich_account(query, depth), enrich_contacts(query, depth)]
    if custom_defs:
        coros.append(enrich_custom(query, custom_defs, depth))
    results = await asyncio.gather(*coros, return_exceptions=True)
    account_res, contacts_res = results[0], results[1]
    custom_res = results[2] if custom_defs else None

    partial = False
    run_ids: list[str] = []

    account_ok = None
    if isinstance(account_res, Exception):
        partial = True
        account_err = account_res
    else:
        account_ok = account_res
        account_err = None
        run_ids.append(account_res["run_id"])

    contacts_ok = None
    if isinstance(contacts_res, Exception):
        partial = True
    else:
        contacts_ok = contacts_res
        run_ids.append(contacts_res["run_id"])

    # Custom run: additive. On failure, synthesize a nulled result so every
    # requested field still renders (blank) and columns stay stable.
    custom_ok = None
    if custom_defs:
        if isinstance(custom_res, Exception):
            partial = True
            custom_ok = {"defs": custom_defs, "content": {}, "basis": []}
        else:
            custom_ok = custom_res
            run_ids.append(custom_res["run_id"])

    # Only hard-fail if we got nothing usable from account AND contacts.
    if account_ok is None and contacts_ok is None:
        if isinstance(account_err, ParallelCallError):
            raise account_err
        raise ParallelCallError(502, "Both Parallel research runs failed. Please retry.")

    latency_ms = int((time.perf_counter() - started) * 1000)
    return to_research_brief(
        query,
        account_ok,
        contacts_ok,
        {"processor": processor, "run_ids": run_ids, "latency_ms": latency_ms, "partial": partial},
        custom_ok,
    )
