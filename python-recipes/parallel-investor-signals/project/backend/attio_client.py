"""
attio_client.py — the REFERENCE CRM adapter (Attio).

This is the worked example of the CRM contract in `crm.py`: a live "in pipeline?"
check that answers, for each signal, *is this company already in the CRM, does it
have active deals, and who owns it?* Copy this file to wire up a different CRM —
implement the same three names (NAME, enabled, check_pipeline) against your CRM's
REST API and register it in crm.py.

Verified against the Attio workspace schema: `companies` records carry `domains`,
`associated_deals` (deal record refs), and `account_owner` (workspace member).

Requires ATTIO_API_KEY (Bearer token) in the env; every helper degrades to
None when it's unset or a call fails — callers fall back to the local
known-companies list and label accordingly.

Sync (httpx) — used from monitor scripts and (via asyncio.to_thread) routes.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

# Self-sufficient env loading (house convention): no-ops on Vercel where the
# key comes from platform env vars.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

# ── CRM contract (see crm.py) ────────────────────────────────────────────────
NAME = "Attio"

_BASE = "https://api.attio.com/v2"


def enabled() -> bool:
    """True when this adapter is configured (ATTIO_API_KEY present)."""
    return bool(os.environ.get("ATTIO_API_KEY"))


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.environ.get('ATTIO_API_KEY', '')}",
        "Content-Type": "application/json",
    }


def _query_companies(filter_: dict[str, Any]) -> list[dict[str, Any]]:
    resp = httpx.post(
        f"{_BASE}/objects/companies/records/query",
        headers=_headers(),
        json={"filter": filter_, "limit": 3},
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


_slug_cache: str | None = None


def _workspace_slug() -> str | None:
    """Workspace slug for building app.attio.com record links (cached)."""
    global _slug_cache
    if _slug_cache:
        return _slug_cache
    try:
        resp = httpx.get(f"{_BASE}/self", headers=_headers(), timeout=10.0)
        resp.raise_for_status()
        _slug_cache = resp.json().get("workspace_slug")
    except Exception:  # noqa: BLE001
        _slug_cache = None
    return _slug_cache


def record_url(record_id: str | None) -> str | None:
    """Deep link to the company record in the Attio app."""
    slug = _workspace_slug()
    if not (slug and record_id):
        return None
    return f"https://app.attio.com/{slug}/company/{record_id}/overview"


def _member_name(membership_id: str) -> str | None:
    """Resolve a workspace member id -> display name (the covering rep)."""
    try:
        resp = httpx.get(f"{_BASE}/workspace_members/{membership_id}", headers=_headers(), timeout=10.0)
        resp.raise_for_status()
        d = resp.json().get("data", {})
        name = f"{d.get('first_name', '')} {d.get('last_name', '')}".strip()
        return name or d.get("email_address")
    except Exception:  # noqa: BLE001
        return None


def check_pipeline(domain: str | None, company: str) -> dict[str, Any] | None:
    """Look a company up in Attio by domain (precise) then name (fallback).

    Returns None when Attio is unavailable/unreachable (caller falls back to
    the local known-companies label), else the normalized CRM match shape
    documented in crm.py: {in_crm, record_id, deal_count, owner, url}.
    """
    if not enabled():
        return None
    try:
        records: list[dict[str, Any]] = []
        if domain and domain != "NA":
            records = _query_companies({"domains": domain.strip().lower()})
        if not records and company:
            records = _query_companies({"name": {"$contains": company.strip()}})
        if not records:
            return {"in_crm": False, "record_id": None, "deal_count": 0, "owner": None, "url": None}

        rec = records[0]
        values = rec.get("values", {})
        deal_count = len(values.get("associated_deals", []) or [])
        owner = None
        owners = values.get("account_owner") or []
        if owners:
            mid = (owners[0].get("referenced_actor_id")
                   or owners[0].get("workspace_membership_id"))
            if mid:
                owner = _member_name(mid)
        rid = (rec.get("id") or {}).get("record_id")
        return {
            "in_crm": True,
            "record_id": rid,
            "deal_count": deal_count,
            "owner": owner,
            "url": record_url(rid),
        }
    except Exception:  # noqa: BLE001 — Attio down ≠ pipeline down
        return None
