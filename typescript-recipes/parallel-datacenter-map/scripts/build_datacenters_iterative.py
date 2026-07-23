#!/usr/bin/env python3
"""
Build a US datacenter list with Parallel ultra2x — iterative / paginated.

THE IDEA (why this works)
─────────────────────────
A single broad "find all US datacenters" query plateaus fast (~50): the model
recalls the facilities it has the most training-signal about (hyperscaler
campuses) and can't reach the long tail of ~1,800 colocation/enterprise/edge
operators. Two techniques fix that:

  1. SHARD by geography. Scope every query to ONE state so enumeration
     (reading directories) is the natural move instead of dumping a global
     top-of-mind list. One dense metro alone (Ashburn) goes 13 → ~90 this way.

  2. PAGINATE via interactions. After the first pass for a state, keep asking
     "find MORE net-new" while passing `previous_interaction_id` — the model
     carries its OWN context of what it already returned in that thread, so we
     never paste a list of known facilities into the prompt. Loop until a page
     stops adding new results ("loop until dry").

Everything is resumable: results checkpoint after each shard, and every run's
`run_id` / `interaction_id` / `previous_interaction_id` is logged so work that
completed server-side is always recoverable (the runs execute on Parallel's
servers regardless of this process staying alive).

USAGE
─────
    export PARALLEL_API_KEY=...
    python build_datacenters_iterative.py                      # all states, until dry
    python build_datacenters_iterative.py --states "Texas,Ohio"
    python build_datacenters_iterative.py --max-pages 3 --min-new 5 --workers 8

OUTPUT
──────
    datacenters.json        deduped list (each record + _shard + _trun provenance)
    datacenters.runs.jsonl  run manifest: {run_id, interaction_id, previous_interaction_id, state, page}
Re-run any time to go deeper; states that have gone dry are skipped.
"""

import argparse
import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from parallel import Parallel

# ── Shards: state is the universal unit (covers all US geography) ──────────────
STATES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
    "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
    "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
    "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
    "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
    "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
    "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
    "Wisconsin", "Wyoming", "District of Columbia",
]

# ── Output schema: everything needed to map & attribute a facility ─────────────
ITEM = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "Facility name."},
        "operator_company": {"type": "string", "description": "Company that operates the facility."},
        "owner_company": {"type": "string", "description": "Owner if different; else same as operator."},
        "address": {"type": "string", "description": "Full street address if known."},
        "city": {"type": "string"},
        "state": {"type": "string", "description": "US state, 2-letter abbreviation."},
        "zip_code": {"type": "string"},
        "latitude": {"type": "number", "description": "Decimal degrees; null if unknown."},
        "longitude": {"type": "number", "description": "Decimal degrees; null if unknown."},
        "year_online": {"type": "string", "description": "Year online (YYYY) or 'unknown'."},
        "power_capacity_mw": {"type": "number", "description": "Critical IT power MW; null if unknown."},
        "total_sqft": {"type": "number", "description": "Total sqft; null if unknown."},
        "facility_type": {"type": "string", "description": "colocation, hyperscale, enterprise, edge, telecom, wholesale, crypto."},
        "status": {"type": "string", "description": "operational, under-construction, planned, unknown."},
        "source_url": {"type": "string", "description": "URL supporting existence/location."},
    },
    "required": ["name", "operator_company", "city", "state"],
    "additionalProperties": False,
}
OUTPUT_SCHEMA = {
    "type": "json",
    "json_schema": {
        "type": "object",
        "properties": {"datacenters": {"type": "array", "items": ITEM}},
        "required": ["datacenters"],
        "additionalProperties": False,
    },
}


def first_prompt(state):
    """Page 1 for a state: exhaustive, directory-anchored, long-tail-aware."""
    return (
        f"Enumerate EVERY physical data center facility located in the U.S. state of {state}. "
        f"Be exhaustive across the whole state — all cities and towns, including secondary and "
        f"smaller markets, not just the largest hub.\n\n"
        f"Go FAR beyond the well-known hyperscaler campuses (AWS, Microsoft, Google, Meta). Most "
        f"facilities are COLOCATION, wholesale, enterprise, telecom/network, and edge, run by a "
        f"long tail of operators (Equinix, Digital Realty, CoreSite, Cyxtera, Iron Mountain, QTS, "
        f"Sabey, Stack, Vantage, Aligned, Flexential, DataBank, Cologix, EdgeConneX, H5, and many "
        f"smaller regional providers). Consult facility directories (datacentermap.com, "
        f"cloudscene.com) and operator site lists to enumerate them.\n\n"
        f"For each facility return name, operator, owner, full street address, city, state, zip, "
        f"latitude/longitude (the specific building), year online, power MW, sqft, facility type, "
        f"and status — with a source_url. PRECISION REQUIRED: each must be a real, individually "
        f"verifiable, physically distinct building; never fabricate; use null/'unknown' for "
        f"anything you cannot verify."
    )


def next_prompt(state):
    """Pages 2..N: the model already has its prior results via the interaction chain."""
    return (
        f"Continue. Return MORE real data center facilities in the U.S. state of {state} that you "
        f"have NOT already returned earlier in this conversation — net-new only, no repeats, no "
        f"fabrication. Push into cities, towns, and operators you have not yet covered (colocation, "
        f"enterprise, telecom, wholesale, edge, crypto). Keep the same fields and precision rules; "
        f"include a real source_url."
    )


# ── Dedupe: address is the most reliable key; the model fills 0.0 for unknown geo ──
def norm(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def dedupe_key(dc):
    addr = norm(dc.get("address"))
    if addr:
        return f"addr:{addr}|{norm(dc.get('city'))}|{norm(dc.get('state'))}"
    lat, lng = dc.get("latitude"), dc.get("longitude")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and (lat, lng) != (0, 0):
        return f"geo:{round(lat, 3)},{round(lng, 3)}"
    return f"name:{norm(dc.get('operator_company'))}|{norm(dc.get('city'))}|{norm(dc.get('state'))}|{norm(dc.get('name'))}"


_lock = threading.Lock()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", default=None, help="Comma-separated states; default = all 51.")
    ap.add_argument("--processor", default="ultra2x", help="ultra2x | ultra2x-fast | ultra4x ...")
    ap.add_argument("--max-pages", type=int, default=6, help="Max pagination pages per state.")
    ap.add_argument("--min-new", type=int, default=3, help="Stop a state when a page adds fewer than this.")
    ap.add_argument("--workers", type=int, default=8, help="States processed concurrently.")
    ap.add_argument("--timeout", type=int, default=3600)
    ap.add_argument("--out", default="datacenters.json")
    args = ap.parse_args()
    if not os.environ.get("PARALLEL_API_KEY"):
        sys.exit("Set PARALLEL_API_KEY")

    client = Parallel(api_key=os.environ["PARALLEL_API_KEY"])
    manifest = args.out.rsplit(".", 1)[0] + ".runs.jsonl"
    targets = [s.strip() for s in args.states.split(",")] if args.states else STATES

    # Resume: load prior results, skip states already done in this file.
    all_dc, done = [], set()
    if os.path.exists(args.out):
        all_dc = json.load(open(args.out)).get("datacenters", [])
        done = {dc.get("_shard") for dc in all_dc}
        print(f"[resume] loaded {len(all_dc)} facilities; {len(done)} states already done.", file=sys.stderr)
    seen = {dedupe_key(dc) for dc in all_dc}

    def log_run(run_id, iid, prev, state, page):
        with _lock:
            with open(manifest, "a") as f:
                f.write(json.dumps({"run_id": run_id, "interaction_id": iid,
                                    "previous_interaction_id": prev, "state": state, "page": page}) + "\n")

    def checkpoint():
        with _lock:
            json.dump({"count": len(all_dc), "datacenters": all_dc}, open(args.out, "w"), indent=2)

    def one_call(state, prev_iid, page):
        kwargs = {"input": first_prompt(state) if page == 1 else next_prompt(state),
                  "processor": args.processor, "task_spec": {"output_schema": OUTPUT_SCHEMA}}
        if prev_iid:
            kwargs["previous_interaction_id"] = prev_iid
        run = client.task_run.create(**kwargs)
        log_run(run.run_id, run.interaction_id, prev_iid, state, page)  # persist BEFORE blocking
        res = client.task_run.result(run.run_id, api_timeout=args.timeout)
        content = res.output.content
        if isinstance(content, str):
            content = json.loads(content)
        items = (content or {}).get("datacenters", []) if isinstance(content, dict) else []
        return items, run.run_id, run.interaction_id

    def process_state(state):
        """Page 1, then paginate via interaction chaining until a page goes dry."""
        prev_iid, total_new = None, 0
        for page in range(1, args.max_pages + 1):
            try:
                items, run_id, iid = one_call(state, prev_iid, page)
            except Exception as e:
                print(f"  [{state} p{page}] error: {e}", file=sys.stderr)
                break
            prev_iid = iid                       # extend the chain
            new = 0
            with _lock:
                for dc in items:
                    k = dedupe_key(dc)
                    if k in seen:
                        continue
                    seen.add(k)
                    dc["_shard"], dc["_trun"] = state, run_id
                    all_dc.append(dc)
                    new += 1
            total_new += new
            print(f"  [{state} p{page}] +{new} net-new (state total this run: {total_new})", file=sys.stderr)
            checkpoint()
            if new < args.min_new:               # loop-until-dry
                break
        return state, total_new

    todo = [s for s in targets if s not in done]
    print(f"processing {len(todo)} states ({args.workers}-wide, {args.processor})", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for fut in as_completed([ex.submit(process_state, s) for s in todo]):
            try:
                s, n = fut.result()
                print(f"[done] {s}: +{n} (grand total {len(all_dc)})", file=sys.stderr)
            except Exception as e:
                print(f"[error] {e}", file=sys.stderr)

    checkpoint()
    print(f"\nDONE. {len(all_dc)} unique facilities -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
