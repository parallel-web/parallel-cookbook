"""
crm.py — the CRM adapter seam.

The pipeline asks ONE question about each signal: *is this company already in
our CRM — does it have active deals, and who owns it?* Any CRM can answer that.
Attio ships as the reference adapter (`attio_client.py`); to wire up yours,
implement the same tiny contract and register it in `_PROVIDERS` below.

──────────────────────────────────────────────────────────────────────────────
The contract — a provider module exposes exactly three names:

    NAME: str
        Display name, e.g. "HubSpot" — used in the Slack pipeline label.

    def enabled() -> bool
        Is the provider configured (its API key present in the env)?

    def check_pipeline(domain: str | None, company: str) -> dict | None
        Look the company up (prefer domain, fall back to name). Return None if
        the CRM is unavailable/unreachable (callers then fall back to the local
        known-companies label). Otherwise return a normalized match:
            {
              "in_crm":     bool,          # found in the CRM?
              "record_id":  str | None,    # CRM record id, if any
              "deal_count": int,           # number of active/associated deals
              "owner":      str | None,    # account owner display name
              "url":        str | None,    # deep link to the record
            }
──────────────────────────────────────────────────────────────────────────────

Select the active provider with the CRM_PROVIDER env var (default: "attio").
Leave every CRM key unset and the pipeline still runs — signals fall back to
the local known-companies list for the "known vs net-new" label.

To add a provider (e.g. HubSpot, Salesforce, Pipedrive):
  1. Copy attio_client.py to hubspot_client.py and implement the three names
     above against that CRM's REST API (its docs give you the query + auth).
  2. Add it to _PROVIDERS.
  3. Set CRM_PROVIDER=hubspot and its API key in .env.
See AGENTS.md — a coding agent can do all three for you.
"""

from __future__ import annotations

import os
from typing import Any

from . import attio_client

# Registry of known CRM adapters. Add your provider module here.
_PROVIDERS = {
    "attio": attio_client,
}


def _provider() -> Any | None:
    name = os.environ.get("CRM_PROVIDER", "attio").strip().lower()
    return _PROVIDERS.get(name)


def crm_name() -> str:
    p = _provider()
    return getattr(p, "NAME", "CRM") if p else "CRM"


def crm_enabled() -> bool:
    p = _provider()
    return bool(p and p.enabled())


def check_pipeline(domain: str | None, company: str) -> dict[str, Any] | None:
    """Delegate to the active provider. None when no CRM is configured/reachable."""
    p = _provider()
    if not (p and p.enabled()):
        return None
    return p.check_pipeline(domain, company)


def pipeline_label(match: dict[str, Any] | None, known_company: bool) -> str:
    """Human line for the Slack message. A live CRM match wins; the local
    known-companies list is the fallback when no CRM answered.

    Deliberately says "in CRM" and "associated deals", NOT "in pipeline / active
    deals": a company record existing in the CRM does not by itself establish an
    open deal. `deal_count` is the number of associated deals across all stages
    (see the adapter). Filter by stage in the adapter if you want a true
    active-pipeline count."""
    name = crm_name()
    if match is None:
        return ("On your known-companies list (CRM check unavailable)" if known_company
                else "Not on your known-companies list (CRM check unavailable)")
    if not match.get("in_crm"):
        return f"Not in {name}"
    bits = [f"In {name}"]
    if match.get("deal_count"):
        n = match["deal_count"]
        bits.append(f"{n} associated deal{'s' if n > 1 else ''}")
    if match.get("owner"):
        bits.append(f"owner: {match['owner']}")
    return ", ".join(bits)
