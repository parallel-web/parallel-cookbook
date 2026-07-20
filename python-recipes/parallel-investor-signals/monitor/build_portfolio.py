"""
build_portfolio.py — regenerate the known-portfolio dedupe list from your CRM
export, so signals can be labeled "already known" vs "net-new".

Input: a CSV with (at least) a company-name column — e.g. an export of your
investors' portfolio companies. Internal columns (notes, ratings, pipeline
state) are ignored on purpose: ONLY the normalized name and an optional
investor column make it into the output, which is safe to keep locally but is
still gitignored by default (see .gitignore).

Usage (backend venv active):
    python monitor/build_portfolio.py data/portcos.csv
    python monitor/build_portfolio.py data/portcos.csv --name-col Company --investor-col Investor

Writes monitor/portfolio_names.json and mirrors it to
project/backend/portfolio_names.json (the copy bundled into the deployed app
for serverless labeling).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

MONITOR_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(MONITOR_DIR.parent / "project"))

from backend.investor_core import norm_company  # noqa: E402 — single normalizer everywhere


def main() -> None:
    ap = argparse.ArgumentParser(description="Derive the names-only portfolio list from a CSV.")
    ap.add_argument("csv_path", help="CSV export containing your portfolio companies")
    ap.add_argument("--name-col", default="Company", help="Column holding the company name")
    ap.add_argument("--investor-col", default="Investor", help="Optional column holding the fund name")
    args = ap.parse_args()

    with open(args.csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit("CSV appears to be empty.")
    if args.name_col not in rows[0]:
        raise SystemExit(
            f"Column {args.name_col!r} not found. Available: {', '.join(rows[0].keys())}"
        )

    out = {}
    for r in rows:
        name = (r.get(args.name_col) or "").strip()
        if not name:
            continue
        out[norm_company(name)] = {
            "name": name,
            "investor": (r.get(args.investor_col) or "").strip(),
        }

    targets = [
        MONITOR_DIR / "portfolio_names.json",
        MONITOR_DIR.parent / "project" / "backend" / "portfolio_names.json",
    ]
    payload = json.dumps(out, indent=1, sort_keys=True) + "\n"
    for t in targets:
        t.write_text(payload)
        print(f"wrote {len(out)} companies -> {t.relative_to(MONITOR_DIR.parent)}")


if __name__ == "__main__":
    main()
