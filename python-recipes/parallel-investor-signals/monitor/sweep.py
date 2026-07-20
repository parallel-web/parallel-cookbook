"""
sweep.py — the BOOTSTRAP: exhaustive Task API sweep of recent history.

Monitors only track forward from creation (no history), so this is the
documented pattern: Task API for the first search, Monitor for everything after.
Runs one structured, cited Task per fund over the last SWEEP_LOOKBACK_DAYS,
dedupes against signals.json, labels known portcos, and prints a digest.

Usage (from repo root, backend venv active):
    python monitor/sweep.py                 # all funds
    python monitor/sweep.py "Accel"             # just one fund from your watchlist
"""

from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor

from common import (
    append_signals, client, known_portco, load_portfolio, print_signal,
    run_structured_task, utcnow,
)
from config import ROUND_SCHEMA, SWEEP_PROCESSOR, priority_for, require_investors, sweep_input


def sweep_fund(c, fund: str, portfolio) -> list:
    print(f"[sweep] {fund} — researching…")
    try:
        res = run_structured_task(c, sweep_input(fund), ROUND_SCHEMA, SWEEP_PROCESSOR, api_timeout=600)
    except Exception as exc:  # noqa: BLE001 — one fund failing shouldn't kill the sweep
        print(f"[sweep] {fund} FAILED: {type(exc).__name__}: {exc}")
        return []

    signals = []
    for r in res["content"].get("rounds", []):
        if str(r.get("is_ai_native", "")).lower() != "yes":
            continue  # qualification gate: AI-native only
        known = bool(known_portco(r.get("company", ""), portfolio))
        signals.append({
            **r,
            "fund_watched": fund,
            "known_portco": known,
            "priority": priority_for(
                r.get("round_stage", ""), r.get("amount_usd_millions", 0),
                r.get("parallel_fit_rating", 0), known,
            ),
            "sources": res["citations"],
            "detected_via": "sweep",
            "run_id": res["run_id"],
            "detected_at": utcnow(),
        })
    print(f"[sweep] {fund}: {len(signals)} qualifying AI-native rounds")
    return signals


def main() -> None:
    funds = [" ".join(sys.argv[1:])] if len(sys.argv) > 1 else require_investors()
    c = client()
    portfolio = load_portfolio()

    # Funds sweep concurrently — each is one independent Task run.
    with ThreadPoolExecutor(max_workers=len(funds)) as pool:
        results = list(pool.map(lambda f: sweep_fund(c, f, portfolio), funds))

    all_signals = [s for batch in results for s in batch]
    added = append_signals(all_signals)

    print(f"\n=== SWEEP DIGEST — {added} new signals (of {len(all_signals)} found) ===")
    for s in all_signals:
        print_signal(s)
    print("\nFull data: monitor/signals.json")


if __name__ == "__main__":
    main()
