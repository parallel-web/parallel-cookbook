"""Run a large CSV through the Parallel Task Group API.

One file, four commands, resumable. Built from the pattern we use for
customer batches in the hundreds of thousands to millions of runs.

    python Large_Scale_Tasks_Recipe.py plan   --input rows.csv --rate-limit 2000
    python Large_Scale_Tasks_Recipe.py submit --input rows.csv --task-spec spec.json \\
        --processor core --id-column row_id --work-dir jobs/run1
    python Large_Scale_Tasks_Recipe.py status --work-dir jobs/run1 --wait
    python Large_Scale_Tasks_Recipe.py export --work-dir jobs/run1 --output results.jsonl

How it works
- One CSV row becomes one run. Every column except --id-column is sent as a
  string field of the input object, or pass --input-json-column to send one
  column as a JSON payload.
- Runs are added 1,000 per request (the API maximum) with refresh_status=False,
  sharded into Task Groups of --runs-per-group.
- Submission is paced at 90% of --rate-limit (runs per minute), because the
  quota counts runs, not requests. A steady rate beats one burst: it enqueues
  cleanly and surfaces a bad spec after thousands of rows, not millions.
- Every add_runs response is appended to work-dir/runs.jsonl before the next
  request goes out, so a crash or re-run never resubmits a paid run.
- status polls each group summary (one cheap GET per group). export streams
  each group's runs to disk with include_output and checks that every input
  row came back exactly once. It exits 2 if anything is missing or duplicated.

Things the API will not do for you
- Runs cannot be cancelled once created. Run `plan`, then a small pilot, then
  the full job. Submit high-priority rows first.
- Your rate limit controls intake, not throughput. Measure a ~5k pilot to
  learn runs/hour for your processor and spec, then extrapolate.

Requires Python 3.11+ and `pip install parallel-web>=1.3`. Set PARALLEL_API_KEY.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

MAX_RUNS_PER_REQUEST = 1_000  # API limit, do not raise
RATE_LIMIT_TARGET = 0.9  # fraction of the quota to use
POLL_INTERVAL_S = 60

csv.field_size_limit(10**9)


# ----------------------------------------------------------------------------- input


def read_rows(path: str, id_column: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit(f"{path}: no rows")
    if id_column not in rows[0]:
        sys.exit(f"{path}: missing id column {id_column!r}. Columns: {list(rows[0])}")
    ids = [r[id_column] for r in rows]
    if len(set(ids)) != len(ids):
        sys.exit(f"{path}: {len(ids) - len(set(ids))} duplicate values in {id_column!r}")
    return rows


def build_input(row: dict[str, str], id_column: str, json_column: str | None) -> Any:
    if json_column:
        try:
            return json.loads(row[json_column])
        except (KeyError, json.JSONDecodeError) as e:
            sys.exit(f"row {row.get(id_column)}: bad JSON in {json_column!r}: {e}")
    return {k: v for k, v in row.items() if k != id_column}


# ----------------------------------------------------------------------------- state


class Job:
    """Append-only state in a work directory. Safe to re-run any command."""

    def __init__(self, work_dir: str):
        self.dir = Path(work_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.config_path = self.dir / "config.json"
        self.groups_path = self.dir / "groups.jsonl"
        self.runs_path = self.dir / "runs.jsonl"

    def save_config(self, cfg: dict[str, Any]) -> None:
        if self.config_path.exists():
            existing = json.loads(self.config_path.read_text())
            if existing != cfg:
                sys.exit(f"{self.config_path} already exists with different settings. Use a new --work-dir.")
        self.config_path.write_text(json.dumps(cfg, indent=2))

    def config(self) -> dict[str, Any]:
        if not self.config_path.exists():
            sys.exit(f"no job at {self.dir}; run submit first")
        return json.loads(self.config_path.read_text())

    def groups(self) -> list[str]:
        return [json.loads(l)["task_group_id"] for l in _lines(self.groups_path)]

    def add_group(self, task_group_id: str) -> None:
        _append(self.groups_path, {"task_group_id": task_group_id, "created_at": time.time()})

    def submitted(self) -> dict[str, dict[str, str]]:
        """row_id -> {run_id, task_group_id}"""
        out: dict[str, dict[str, str]] = {}
        for l in _lines(self.runs_path):
            rec = json.loads(l)
            out[rec["row_id"]] = rec
        return out

    def add_runs(self, task_group_id: str, pairs: list[tuple[str, str]]) -> None:
        with open(self.runs_path, "a", encoding="utf-8") as f:
            for row_id, run_id in pairs:
                f.write(json.dumps({"row_id": row_id, "run_id": run_id, "task_group_id": task_group_id}) + "\n")
            f.flush()


def _lines(path: Path) -> list[str]:
    return [l for l in path.read_text().splitlines() if l.strip()] if path.exists() else []


def _append(path: Path, rec: dict[str, Any]) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")
        f.flush()


# ----------------------------------------------------------------------------- plan


def plan(n_runs: int, rate_limit: float, runs_per_group: int) -> dict[str, Any]:
    per_min = rate_limit * RATE_LIMIT_TARGET
    posts = math.ceil(n_runs / MAX_RUNS_PER_REQUEST)
    return {
        "runs": n_runs,
        "posts": posts,
        "task_groups": math.ceil(n_runs / runs_per_group),
        "submit_rate_runs_per_min": per_min,
        "enqueue_minutes": round(n_runs / per_min, 1),
        "note": "Enqueue time only. Execution time depends on processor, spec, and platform load: run a ~5k pilot and extrapolate.",
    }


# ----------------------------------------------------------------------------- submit


def cmd_submit(args: argparse.Namespace) -> None:
    from parallel import Parallel

    rows = read_rows(args.input, args.id_column)
    task_spec = json.loads(Path(args.task_spec).read_text())
    job = Job(args.work_dir)
    job.save_config(
        {
            "input": str(Path(args.input).resolve()),
            "id_column": args.id_column,
            "input_json_column": args.input_json_column,
            "processor": args.processor,
            "runs_per_group": args.runs_per_group,
            "label": args.label,
        }
    )
    done = job.submitted()
    pending = [r for r in rows if r[args.id_column] not in done]
    print(f"{len(rows)} rows, {len(done)} already submitted, {len(pending)} to go")
    if args.dry_run or not pending:
        print(json.dumps(plan(len(pending), args.rate_limit, args.runs_per_group), indent=2))
        return

    client = Parallel()
    per_request_s = 60.0 * MAX_RUNS_PER_REQUEST / (args.rate_limit * RATE_LIMIT_TARGET)
    groups = job.groups()
    group_fill = _group_fill(job)

    i = 0
    while i < len(pending):
        # pick a group with room, or create one
        gid = next((g for g in groups if group_fill.get(g, 0) < args.runs_per_group), None)
        if gid is None:
            gid = client.task_group.create(metadata={"label": args.label} if args.label else None).task_group_id
            job.add_group(gid)
            groups.append(gid)
        room = args.runs_per_group - group_fill.get(gid, 0)
        batch = pending[i : i + min(MAX_RUNS_PER_REQUEST, room)]
        inputs = [
            {
                "input": build_input(r, args.id_column, args.input_json_column),
                "processor": args.processor,
                "metadata": {"row_id": r[args.id_column], **({"label": args.label} if args.label else {})},
            }
            for r in batch
        ]
        started = time.monotonic()
        resp = client.task_group.add_runs(gid, inputs=inputs, default_task_spec=task_spec, refresh_status=False)
        if len(resp.run_ids) != len(batch):
            sys.exit(f"server returned {len(resp.run_ids)} run ids for {len(batch)} inputs; reconcile {gid} before continuing")
        job.add_runs(gid, list(zip((r[args.id_column] for r in batch), resp.run_ids)))
        group_fill[gid] = group_fill.get(gid, 0) + len(batch)
        i += len(batch)
        print(f"  {i}/{len(pending)} submitted ({gid})")
        time.sleep(max(0.0, per_request_s - (time.monotonic() - started)))
    print("done. next: status --wait, then export")


def _group_fill(job: Job) -> dict[str, int]:
    fill: dict[str, int] = {}
    for rec in job.submitted().values():
        fill[rec["task_group_id"]] = fill.get(rec["task_group_id"], 0) + 1
    return fill


# ----------------------------------------------------------------------------- status


def cmd_status(args: argparse.Namespace) -> None:
    from parallel import Parallel

    job = Job(args.work_dir)
    client = Parallel()
    while True:
        counts: dict[str, int] = {}
        active = 0
        for gid in job.groups():
            st = client.task_group.retrieve(gid).status
            active += st.is_active
            for k, v in (st.task_run_status_counts or {}).items():
                counts[k] = counts.get(k, 0) + v
        total = sum(counts.values())
        done = counts.get("completed", 0) + counts.get("failed", 0) + counts.get("cancelled", 0)
        print(f"{time.strftime('%H:%M:%S')} {done}/{total} finished  {counts}  active_groups={active}")
        if not active or not args.wait:
            return
        time.sleep(POLL_INTERVAL_S)


# ----------------------------------------------------------------------------- export


def cmd_export(args: argparse.Namespace) -> None:
    from parallel import Parallel

    job = Job(args.work_dir)
    client = Parallel()
    expected = job.submitted()
    run_to_row = {rec["run_id"]: row_id for row_id, rec in expected.items()}
    seen: dict[str, int] = {}
    n_written = n_failed = n_active = 0

    with open(args.output, "w", encoding="utf-8") as out:
        for gid in job.groups():
            for event in client.task_group.get_runs(gid, include_input=args.include_input, include_output=True):
                if event.type != "task_run.state":
                    print(f"  stream error in {gid}: {event}", file=sys.stderr)
                    continue
                run = event.run
                row_id = run_to_row.get(run.run_id)
                if row_id is None:
                    print(f"  unexpected run {run.run_id} in {gid}", file=sys.stderr)
                    seen["__unexpected__"] = seen.get("__unexpected__", 0) + 1
                    continue
                if run.is_active:
                    n_active += 1
                    continue
                seen[row_id] = seen.get(row_id, 0) + 1
                rec: dict[str, Any] = {"row_id": row_id, "run_id": run.run_id, "status": run.status}
                if event.output is not None:
                    rec["output"] = event.output.content
                    rec["basis"] = [b.model_dump() for b in event.output.basis]
                if run.status == "failed":
                    n_failed += 1
                    rec["error"] = run.error.model_dump() if run.error else None
                if args.include_input and event.input is not None:
                    rec["input"] = event.input.input
                out.write(json.dumps(rec, default=str) + "\n")
                n_written += 1

    missing = [r for r in expected if r not in seen]
    duplicated = {r: c for r, c in seen.items() if c > 1 and r != "__unexpected__"}
    report = {
        "expected_rows": len(expected),
        "written": n_written,
        "failed": n_failed,
        "still_active": n_active,
        "missing": len(missing),
        "duplicated": len(duplicated),
        "unexpected": seen.get("__unexpected__", 0),
        "ok": not missing and not duplicated and not n_active and not seen.get("__unexpected__"),
    }
    Path(args.output + ".validation.json").write_text(json.dumps({**report, "missing_row_ids": missing[:1000]}, indent=2))
    print(json.dumps(report, indent=2))
    if not report["ok"]:
        sys.exit(2)


# ----------------------------------------------------------------------------- cli


def cmd_plan(args: argparse.Namespace) -> None:
    n = args.runs if args.runs else len(read_rows(args.input, args.id_column))
    print(json.dumps(plan(n, args.rate_limit, args.runs_per_group), indent=2))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--rate-limit", type=float, default=2000, help="your Tasks quota in runs per minute (default 2000)")
        sp.add_argument("--runs-per-group", type=int, default=10_000, help="runs per Task Group (default 10000)")

    a = sub.add_parser("plan", help="count runs, requests, groups and enqueue time. No API calls")
    a.add_argument("--input")
    a.add_argument("--runs", type=int, help="instead of --input, plan for this many runs")
    a.add_argument("--id-column", default="row_id")
    common(a)
    a.set_defaults(func=cmd_plan)

    s = sub.add_parser("submit", help="create runs; re-run to resume")
    s.add_argument("--input", required=True)
    s.add_argument("--task-spec", required=True, help="JSON file with output_schema (and optional input_schema)")
    s.add_argument("--processor", required=True)
    s.add_argument("--work-dir", required=True)
    s.add_argument("--id-column", default="row_id")
    s.add_argument("--input-json-column", help="send this column parsed as JSON instead of all columns")
    s.add_argument("--label", help="batch label stored in run and group metadata")
    s.add_argument("--dry-run", action="store_true", help="validate the CSV and print the plan only")
    common(s)
    s.set_defaults(func=cmd_submit)

    t = sub.add_parser("status", help="progress across all groups")
    t.add_argument("--work-dir", required=True)
    t.add_argument("--wait", action="store_true", help=f"poll every {POLL_INTERVAL_S}s until no group is active")
    t.set_defaults(func=cmd_status)

    e = sub.add_parser("export", help="write results.jsonl and validate; exit 2 if rows are missing")
    e.add_argument("--work-dir", required=True)
    e.add_argument("--output", required=True)
    e.add_argument("--include-input", action="store_true")
    e.set_defaults(func=cmd_export)
    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
