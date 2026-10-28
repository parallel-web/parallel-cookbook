"""Equity tear sheets for a CSV of companies, researched with the Parallel Task API and rendered to PDF.

    uv run tearsheet.py companies.csv                # research every row, then render
    uv run tearsheet.py companies.csv --limit 3      # pilot on the first three rows
    uv run tearsheet.py companies.csv --render-only  # re-render saved research, no API calls

The CSV needs company_name and ticker columns; website is optional but lets the
financials run stick to the company's own filings. One Task Group holds every
run for the CSV. Per company:

  profile, financials, market, news, signals   five focused runs on core, started together
  thesis                                       one pro run, started as soon as that company's
                                               sections finish, with their facts as its input

Each batch is recorded in <out>/state.json before submission, with submission
retries disabled. Interrupted submissions are reconciled against the Task Group
before any new runs start. Results land in <out>/data/<TICKER>.json and PDFs in <out>/pdf/.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv

import render
import spec

SECTION_PROCESSOR = "core"
THESIS_PROCESSOR = "pro"
NEWS_WINDOW_DAYS = 90
POLL_SECONDS = 15
MAX_RUNS_PER_REQUEST = 1_000  # Task Group API limit
MAX_FACTS_CHARS = 20_000  # the thesis spec plus its input must stay under 25,000 characters
TERMINAL = {"completed", "failed", "cancelled"}
PRICE = {"core": 0.025, "pro": 0.10}  # per run, https://docs.parallel.ai/getting-started/pricing


# ----------------------------------------------------------------------------- input


def read_companies(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [{k.strip().lower(): (v or "").strip() for k, v in row.items() if k} for row in csv.DictReader(f)]
    missing = {"company_name", "ticker"} - set(rows[0] if rows else {})
    if missing:
        sys.exit(f"{path}: needs columns company_name and ticker (missing {', '.join(sorted(missing))})")
    companies = []
    for row in rows:
        if row["company_name"] and row["ticker"]:
            website = re.sub(r"^https?://(www\.)?", "", row.get("website", "")).split("/")[0]
            companies.append({"company_name": row["company_name"], "ticker": row["ticker"].upper(), "website": website})
    tickers = [c["ticker"] for c in companies]
    if dupes := sorted({t for t in tickers if tickers.count(t) > 1}):
        sys.exit(f"{path}: duplicate tickers {', '.join(dupes)}")
    return companies


# ----------------------------------------------------------------------------- state


class Job:
    """Run ids and results for one output folder."""

    def __init__(self, out: Path):
        self.out = out
        (out / "data").mkdir(parents=True, exist_ok=True)
        self.state_path = out / "state.json"
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {"task_group_id": None, "runs": {}}

    def save(self) -> None:
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, indent=2))
        tmp.replace(self.state_path)

    def runs(self, ticker: str) -> dict[str, str | None]:
        return self.state["runs"].setdefault(ticker, {})

    def write(self, company: dict, runs: dict) -> None:
        path = self.out / "data" / f"{render.slug(company['ticker'])}.json"
        path.write_text(json.dumps({"company": company, "runs": runs}, indent=2, default=str))


# ----------------------------------------------------------------------------- runs


def section_run(company: dict, section: str) -> dict:
    run = {
        "input": company,
        "processor": SECTION_PROCESSOR,
        "task_spec": spec.SECTIONS[section],
        "metadata": {"ticker": company["ticker"], "section": section},
    }
    if section == "financials" and company["website"]:
        # Primary sources only: SEC filings, the company's own site, and the CDN many IR sites host reports on.
        run["source_policy"] = {"include_domains": ["sec.gov", company["website"], "q4cdn.com"]}
    if section == "news":
        run["source_policy"] = {"after_date": (date.today() - timedelta(days=NEWS_WINDOW_DAYS)).isoformat()}
    return run


def thesis_run(company: dict, facts: dict) -> dict:
    return {
        "input": {
            "company_name": company["company_name"],
            "ticker": company["ticker"],
            "facts": json.dumps(facts, separators=(",", ":"))[:MAX_FACTS_CHARS],
        },
        "processor": THESIS_PROCESSOR,
        "task_spec": spec.THESIS,
        "metadata": {"ticker": company["ticker"], "section": "thesis"},
    }


def recover_pending(client, job: Job) -> None:
    """Recover an interrupted batch, or stop while its outcome is uncertain."""
    if not job.state.get("pending"):
        return
    expected = {tuple(pair) for pair in job.state["pending"]}
    recovered = {}
    with client.task_group.get_runs(job.state["task_group_id"]) as events:
        for event in events:
            if event.type != "task_run.state":
                sys.exit(f"Could not reconcile the pending batch. Keep {job.state_path} and retry later.")
            metadata = event.run.metadata or {}
            pair = (metadata.get("ticker"), metadata.get("section"))
            if pair not in expected:
                continue
            if pair in recovered and recovered[pair] != event.run.run_id:
                sys.exit(f"Duplicate runs for {pair}. Keep {job.state_path} and reconcile the Task Group manually.")
            recovered[pair] = event.run.run_id
    if recovered.keys() != expected:
        sys.exit(
            f"Pending batch is unresolved ({len(recovered)}/{len(expected)} runs found). "
            f"Keep {job.state_path} and retry later; do not resubmit or delete the state file."
        )
    for (ticker, section), run_id in recovered.items():
        job.runs(ticker)[section] = run_id
    del job.state["pending"]
    job.save()


def submit(client, job: Job, runs: list[tuple[str, str, dict]]) -> None:
    """Record each batch before its non-idempotent POST, then save the returned ids."""
    if job.state.get("pending"):
        sys.exit(f"An unresolved batch remains in {job.state_path}. Resume the job before submitting more runs.")
    for i in range(0, len(runs), MAX_RUNS_PER_REQUEST):
        batch = runs[i : i + MAX_RUNS_PER_REQUEST]
        job.state["pending"] = [[ticker, section] for ticker, section, _ in batch]
        job.save()
        resp = client.with_options(max_retries=0).task_group.add_runs(job.state["task_group_id"], inputs=[r for _, _, r in batch])
        for (ticker, section, _), run_id in zip(batch, resp.run_ids, strict=True):
            job.runs(ticker)[section] = run_id
        del job.state["pending"]
        job.save()


def statuses(client, group_id: str) -> dict[str, str]:
    return {e.run.run_id: e.run.status for e in client.task_group.get_runs(group_id) if e.type == "task_run.state"}


def start_theses(client, job: Job, companies: list[dict], status: dict[str, str]) -> None:
    """Start a thesis for every company whose sections have all finished."""
    ready = []
    for c in companies:
        runs = job.runs(c["ticker"])
        if "thesis" in runs or any(status.get(runs.get(s)) not in TERMINAL for s in spec.SECTIONS):
            continue
        facts = {s: client.task_run.result(runs[s]).output.content for s in spec.SECTIONS if status[runs[s]] == "completed"}
        if facts:
            ready.append((c["ticker"], "thesis", thesis_run(c, facts)))
        else:
            runs["thesis"] = None  # every section failed; nothing to reason over
            job.save()
    if ready:
        submit(client, job, ready)


def progress(job: Job, companies: list[dict], status: dict[str, str], started: float) -> bool:
    done = defaultdict(int)
    for c in companies:
        for section, run_id in job.runs(c["ticker"]).items():
            kind = "thesis" if section == "thesis" else "sections"
            done[kind] += run_id is None or status.get(run_id) in TERMINAL
            done["failed"] += status.get(run_id) == "failed"
    print(
        f"  {time.strftime('%H:%M:%S')}  sections {done['sections']}/{len(companies) * len(spec.SECTIONS)}"
        f"  thesis {done['thesis']}/{len(companies)}  failed {done['failed']}  ({(time.time() - started) / 60:.1f} min)",
        flush=True,
    )
    return done["thesis"] == len(companies)


def collect(client, job: Job, companies: list[dict]) -> None:
    owner = {run_id: (t, s) for t, runs in job.state["runs"].items() for s, run_id in runs.items() if run_id}
    results = defaultdict(dict)
    for e in client.task_group.get_runs(job.state["task_group_id"], include_output=True):
        if e.type != "task_run.state" or e.run.run_id not in owner:
            continue
        ticker, section = owner[e.run.run_id]
        results[ticker][section] = {
            "run_id": e.run.run_id,
            "status": e.run.status,
            "processor": e.run.processor,
            "content": e.output.content if e.output else None,
            "basis": [b.model_dump() for b in e.output.basis] if e.output else [],
            "error": e.run.error.model_dump() if e.run.error else None,
        }
    for c in companies:
        job.write(c, results[c["ticker"]])


def research(client, job: Job, companies: list[dict]) -> None:
    if not job.state["task_group_id"]:
        job.state["task_group_id"] = client.task_group.create(metadata={"recipe": "parallel-tear-sheets"}).task_group_id
        job.save()
    recover_pending(client, job)
    new = [(c["ticker"], s, section_run(c, s)) for c in companies for s in spec.SECTIONS if s not in job.runs(c["ticker"])]
    if new:
        print(f"Starting {len(new)} section runs in task group {job.state['task_group_id']}")
        submit(client, job, new)

    started = time.time()
    while True:
        status = statuses(client, job.state["task_group_id"])
        start_theses(client, job, companies, status)
        if progress(job, companies, statuses(client, job.state["task_group_id"]), started):
            break
        time.sleep(POLL_SECONDS)
    collect(client, job, companies)


# ----------------------------------------------------------------------------- main


def main() -> None:
    load_dotenv(Path(__file__).with_name(".env"))
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("csv", help="CSV with company_name, ticker and optional website columns")
    p.add_argument("--out", default="out", help="output folder (default: out)")
    p.add_argument("--limit", type=int, help="only the first N companies, for a pilot")
    p.add_argument("--render-only", action="store_true", help="re-render saved research without calling the API")
    args = p.parse_args()

    render.ensure_pdf_support()
    companies = read_companies(args.csv)[: args.limit]
    job = Job(Path(args.out))

    if not args.render_only:
        if not os.environ.get("PARALLEL_API_KEY"):
            sys.exit("Set PARALLEL_API_KEY in your environment or in a .env file (see .env.example).")
        from parallel import AuthenticationError, Parallel

        n, k = len(companies), len(spec.SECTIONS)
        cost = n * (k * PRICE[SECTION_PROCESSOR] + PRICE[THESIS_PROCESSOR])
        print(f"Researching {n} companies with {n * (k + 1)} Task runs, about ${cost:.2f} at list prices")
        try:
            research(Parallel(), job, companies)
        except AuthenticationError:
            sys.exit("Parallel rejected PARALLEL_API_KEY. Check the key at https://platform.parallel.ai.")

    written, incomplete = render.render_all(job.out, companies)
    print(f"Wrote {len(written)} tear sheets to {job.out / 'pdf'}" + (f" and {job.out / 'tearsheets.pdf'}" if written else ""))
    if incomplete:
        sys.exit(f"Incomplete output for {', '.join(incomplete)}. Check the saved research and render errors above.")


if __name__ == "__main__":
    main()
