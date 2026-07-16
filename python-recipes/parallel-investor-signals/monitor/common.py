"""
common.py — shared plumbing for the monitoring pipeline: Parallel client, the
known-portco dedupe list, signal storage, and a small structured-Task runner.

Run everything with the backend venv python:
    source project/backend/.venv/bin/activate
    python monitor/<script>.py
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, UTC
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

from parallel import Parallel  # noqa: E402

# Same beta as the enrichment backend: per-field citations on task outputs.
FIELD_BASIS_BETA = "field-basis-2025-11-25"

# Generated artifacts (gitignored): monitor ids, seen-event state, signals.
MONITORS_FILE = ROOT / "monitor" / "monitors.json"
STATE_FILE = ROOT / "monitor" / "state.json"
SIGNALS_FILE = ROOT / "monitor" / "signals.json"
PORTFOLIO_FILE = ROOT / "monitor" / "portfolio_names.json"


def client() -> Parallel:
    key = os.environ.get("PARALLEL_API_KEY")
    if not key:
        raise SystemExit("PARALLEL_API_KEY missing — add it to the repo-root .env")
    return Parallel(api_key=key, timeout=600.0)


# ------------------------------------------------------------ portfolio dedupe
def _norm(name: str) -> str:
    n = name.lower().strip()
    n = re.sub(r"[.,']", "", n)
    n = re.sub(r"\s+(inc|llc|ltd|corp|co|ai)$", "", n)
    return re.sub(r"\s+", " ", n).strip()


def load_portfolio() -> dict[str, Any]:
    if PORTFOLIO_FILE.exists():
        return json.loads(PORTFOLIO_FILE.read_text())
    return {}


def known_portco(company: str, portfolio: dict[str, Any]) -> dict[str, Any] | None:
    """Already on your known-companies list? Signals aren't suppressed for known
    companies (a fresh round in a company you know is still news) — just labeled."""
    return portfolio.get(_norm(company))


# ------------------------------------------------------------------- json io
def read_json(path: Path, default: Any) -> Any:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            return default
    return default


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=1, sort_keys=False) + "\n")


# ------------------------------------------------------------------- signals
def append_signals(new: list[dict[str, Any]]) -> int:
    """Append signals, deduped by (company, round_stage). Returns #added."""
    signals = read_json(SIGNALS_FILE, [])
    seen = {(_norm(s.get("company", "")), (s.get("round_stage") or "").lower()) for s in signals}
    added = 0
    for s in new:
        k = (_norm(s.get("company", "")), (s.get("round_stage") or "").lower())
        if k in seen:
            continue
        seen.add(k)
        signals.append(s)
        added += 1
    write_json(SIGNALS_FILE, signals)
    return added


def print_signal(s: dict[str, Any]) -> None:
    flag = "KNOWN PORTCO" if s.get("known_portco") else "NEW — not on portco sheet"
    print(f"  ▸ {s.get('company')} — {s.get('round_stage')}, {s.get('amount')}"
          f" ({s.get('announced_date')})  [{flag}]")
    print(f"    {s.get('one_liner') or s.get('summary') or ''}")
    inv = s.get("lead_investor") or s.get("investors") or ""
    if inv:
        print(f"    investors: {inv}" + (f" + {s['co_investors']}" if s.get("co_investors") else ""))
    for u in (s.get("sources") or [])[:3]:
        print(f"    source: {u}")


# ------------------------------------------------------- structured task run
def run_structured_task(
    c: Parallel,
    input_text: str,
    output_schema: dict[str, Any],
    processor: str,
    previous_interaction_id: str | None = None,
    api_timeout: int = 300,
) -> dict[str, Any]:
    """One Task API run with a JSON output schema + field-basis citations.
    Returns {content, citations, run_id}. `previous_interaction_id` chains a
    monitor event's context into the run (the documented follow-up pattern)."""
    kwargs: dict[str, Any] = dict(
        input=input_text,
        processor=processor,
        task_spec={"output_schema": {"type": "json", "json_schema": output_schema}},
        betas=[FIELD_BASIS_BETA],
    )
    if previous_interaction_id:
        kwargs["previous_interaction_id"] = previous_interaction_id
    run = c.task_run.create(**kwargs)
    result = c.task_run.result(run.run_id, api_timeout=api_timeout, betas=[FIELD_BASIS_BETA])

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
    return {"content": content or {}, "citations": urls, "run_id": run.run_id}


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
