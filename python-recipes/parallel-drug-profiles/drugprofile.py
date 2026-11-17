"""Drug asset profiles for a CSV of drugs, researched with the Parallel Task API and its free healthcare connectors.

    uv run drugprofile.py assets.csv                 # research every row, check it, render PDFs
    uv run drugprofile.py assets.csv --limit 2       # pilot on the first two rows
    uv run drugprofile.py assets.csv --render-only   # re-check and re-render saved research, no Parallel calls

The CSV needs asset and sponsor columns; focus_indication is optional. One Task
Group holds every run for the CSV. Per asset:

  identity, regulatory, news,                      six focused runs on core, started together
  trials, evidence, market
  outlook                                          one pro run, started when that asset's sections
                                                   finish, with their facts as its input
  label                                            Extract copies "Indications and Usage" from the
                                                   DailyMed label word for word
  image                                            the Images API finds a product photo; Python keeps it
                                                   only if it is official, names the drug and decodes
  checks                                           Python checks every identifier against its registry
  render                                           one PDF per asset in <out>/pdf, and <out>/profiles.pdf

Each batch is recorded in <out>/state.json before submission, with submission
retries disabled, so an interrupted run resumes without duplicating work.
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

import checks
import images
import render
import spec

SECTION_PROCESSOR = "core"
OUTLOOK_PROCESSOR = "pro"
POLL_SECONDS = 15
MAX_RUNS_PER_REQUEST = 1_000
MAX_FACTS_CHARS = 20_000
TERMINAL = {"completed", "failed", "cancelled"}
PRICE = {"core": 0.025, "pro": 0.10, "extract": 0.001, "images": 0.005}  # per run or URL, https://docs.parallel.ai/getting-started/pricing
LABEL_FETCH = {"max_age_seconds": 86_400}  # a label at most a day old


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# ----------------------------------------------------------------------------- input


def read_assets(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [{k.strip().lower(): (v or "").strip() for k, v in row.items() if k} for row in csv.DictReader(f)]
    missing = {"asset", "sponsor"} - set(rows[0] if rows else {})
    if missing:
        sys.exit(f"{path}: needs columns asset and sponsor (missing {', '.join(sorted(missing))})")
    assets = [
        {"asset": r["asset"], "sponsor": r["sponsor"], "focus_indication": r.get("focus_indication", "")}
        for r in rows
        if r["asset"] and r["sponsor"]
    ]
    keys = [slug(a["asset"]) for a in assets]
    if dupes := sorted({k for k in keys if keys.count(k) > 1}):
        sys.exit(f"{path}: duplicate assets {', '.join(dupes)}")
    return assets


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

    def runs(self, key: str) -> dict[str, str | None]:
        return self.state["runs"].setdefault(key, {})

    def path(self, asset: dict) -> Path:
        return self.out / "data" / f"{slug(asset['asset'])}.json"


# ----------------------------------------------------------------------------- runs


def section_run(asset: dict, section: str, connectors: bool = True) -> dict:
    run = {
        "input": asset,
        "processor": SECTION_PROCESSOR,
        "task_spec": spec.SECTIONS[section],
        "metadata": {"asset": slug(asset["asset"]), "section": section},
    }
    if section == "regulatory":
        # Regulators only: approvals, labels and dates come from FDA, DailyMed, EMA, NMPA and PMDA, not from press coverage.
        run["source_policy"] = {"include_domains": spec.REGULATOR_DOMAINS}
    if section == "news":
        # The open web, last 12 months: submissions, decisions and rejections that sponsors announce before regulators publish.
        run["source_policy"] = {"after_date": (date.today() - timedelta(days=spec.NEWS_WINDOW_DAYS)).isoformat()}
    if connectors and section in spec.CONNECTORS:
        run["advanced_settings"] = {"data_sources": {"free": spec.CONNECTORS[section]}}
    return run


def outlook_run(asset: dict, facts: dict) -> dict:
    return {
        "input": {**asset, "facts": json.dumps(facts, separators=(",", ":"))[:MAX_FACTS_CHARS]},
        "processor": OUTLOOK_PROCESSOR,
        "task_spec": spec.OUTLOOK,
        "metadata": {"asset": slug(asset["asset"]), "section": "outlook"},
    }


def recover_pending(client, job: Job) -> None:
    """Recover an interrupted batch, or stop while its outcome is uncertain."""
    if not job.state.get("pending"):
        return
    expected = {tuple(pair) for pair in job.state["pending"]}
    recovered = {}
    for event in client.task_group.get_runs(job.state["task_group_id"]):
        if event.type != "task_run.state":
            continue
        meta = event.run.metadata or {}
        pair = (meta.get("asset"), meta.get("section"))
        if pair in expected:
            if pair in recovered and recovered[pair] != event.run.run_id:
                sys.exit(f"Duplicate runs for {pair}. Keep {job.state_path} and reconcile the Task Group manually.")
            recovered[pair] = event.run.run_id
    if recovered.keys() != expected:
        sys.exit(f"Pending batch is unresolved ({len(recovered)}/{len(expected)} runs found). Keep {job.state_path} and retry later.")
    for (key, section), run_id in recovered.items():
        job.runs(key)[section] = run_id
    del job.state["pending"]
    job.save()


def submit(client, job: Job, runs: list[tuple[str, str, dict]]) -> None:
    """Record each batch before its non-idempotent POST, then save the returned ids."""
    for i in range(0, len(runs), MAX_RUNS_PER_REQUEST):
        batch = runs[i : i + MAX_RUNS_PER_REQUEST]
        job.state["pending"] = [[key, section] for key, section, _ in batch]
        job.save()
        resp = client.with_options(max_retries=0).task_group.add_runs(job.state["task_group_id"], inputs=[r for _, _, r in batch])
        for (key, section, _), run_id in zip(batch, resp.run_ids, strict=True):
            job.runs(key)[section] = run_id
        del job.state["pending"]
        job.save()


def statuses(client, group_id: str) -> dict[str, str]:
    return {e.run.run_id: e.run.status for e in client.task_group.get_runs(group_id) if e.type == "task_run.state"}


def start_outlooks(client, job: Job, assets: list[dict], status: dict[str, str]) -> None:
    ready = []
    for a in assets:
        runs = job.runs(slug(a["asset"]))
        if "outlook" in runs or any(status.get(runs.get(s)) not in TERMINAL for s in spec.SECTIONS):
            continue
        facts = {s: client.task_run.result(runs[s]).output.content for s in spec.SECTIONS if status[runs[s]] == "completed"}
        if facts:
            ready.append((slug(a["asset"]), "outlook", outlook_run(a, facts)))
        else:
            runs["outlook"] = None
            job.save()
    if ready:
        submit(client, job, ready)


def progress(job: Job, assets: list[dict], status: dict[str, str], started: float) -> bool:
    done = defaultdict(int)
    for a in assets:
        for section, run_id in job.runs(slug(a["asset"])).items():
            kind = "outlook" if section == "outlook" else "sections"
            done[kind] += run_id is None or status.get(run_id) in TERMINAL
            done["failed"] += status.get(run_id) == "failed"
    print(
        f"  {time.strftime('%H:%M:%S')}  sections {done['sections']}/{len(assets) * len(spec.SECTIONS)}"
        f"  outlook {done['outlook']}/{len(assets)}  failed {done['failed']}  ({(time.time() - started) / 60:.1f} min)",
        flush=True,
    )
    return done["outlook"] == len(assets)


def collect(client, job: Job, assets: list[dict]) -> None:
    owner = {run_id: (k, s) for k, runs in job.state["runs"].items() for s, run_id in runs.items() if run_id}
    results = defaultdict(dict)
    for e in client.task_group.get_runs(job.state["task_group_id"], include_output=True):
        if e.type != "task_run.state" or e.run.run_id not in owner:
            continue
        key, section = owner[e.run.run_id]
        out = e.output
        results[key][section] = {
            "run_id": e.run.run_id,
            "status": e.run.status,
            "processor": e.run.processor,
            "content": out.content if out else None,
            "basis": [b.model_dump() for b in out.basis] if out else [],
            "connector_calls": [
                {"connector": c.server_name, "tool": c.tool_name, "arguments": c.arguments, "error": c.error}
                for c in (getattr(out, "mcp_tool_calls", None) or [])
            ],
            "error": e.run.error.model_dump() if e.run.error else None,
        }
    for a in assets:
        job.path(a).write_text(json.dumps({"asset": a, "runs": results[slug(a["asset"])]}, indent=2, default=str))


def research(client, job: Job, assets: list[dict], connectors: bool = True) -> None:
    if not job.state["task_group_id"]:
        job.state["task_group_id"] = client.task_group.create(metadata={"recipe": "parallel-drug-profiles"}).task_group_id
        job.save()
    recover_pending(client, job)
    new = [(slug(a["asset"]), s, section_run(a, s, connectors)) for a in assets for s in spec.SECTIONS if s not in job.runs(slug(a["asset"]))]
    if new:
        print(f"Starting {len(new)} section runs in task group {job.state['task_group_id']}")
        submit(client, job, new)
    started = time.time()
    while True:
        status = statuses(client, job.state["task_group_id"])
        start_outlooks(client, job, assets, status)
        if progress(job, assets, statuses(client, job.state["task_group_id"]), started):
            break
        time.sleep(POLL_SECONDS)
    collect(client, job, assets)


# ----------------------------------------------------------------------------- label (Extract, copied word for word)


def copy_labels(client, job: Job, assets: list[dict]) -> None:
    """Extract the DailyMed label for each US-approved asset and copy section 1 verbatim. No model writes this text."""
    for a in assets:
        data = json.loads(job.path(a).read_text())
        reg = (data["runs"].get("regulatory") or {}).get("content") or {}
        setid = (reg.get("us") or {}).get("dailymed_setid", "").strip().lower()
        if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", setid):
            data["label"] = {"setid": setid, "status": "no DailyMed set ID"}
        else:
            url = f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={setid}"
            res = client.extract(urls=[url], advanced_settings={"full_content": True, "fetch_policy": LABEL_FETCH}).results
            page = res[0].full_content if res else ""
            data["label"] = {"setid": setid, "url": url, **checks.label_section(page or "")}
        job.path(a).write_text(json.dumps(data, indent=2, default=str))


# ----------------------------------------------------------------------------- product image (Images API)


def find_images(client, job: Job, assets: list[dict]) -> None:
    """One product photo per asset, vetted in images.py. Saved results are reused, so a resumed job does not search twice."""
    for a in assets:
        data = json.loads(job.path(a).read_text())
        if (data.get("image") or {}).get("status") == "found" and (job.out / data["image"]["file"]).exists():
            continue
        identity = (data["runs"].get("identity") or {}).get("content") or {}
        try:
            data["image"] = images.product_image(client, a, identity, job.out / "images", slug(a["asset"]))
        except Exception as e:  # an image is optional; never let it stop the profile
            data["image"] = {"status": f"search failed: {e!r}"[:200]}
        img = data["image"]
        print(f"  {a['asset']}: image {img['status']}" + (f" from {images.host(img['source_page_url'])}" if img["status"] == "found" else "")
              + (f", {len(img.get('rejected', []))} candidates rejected" if img.get("rejected") else ""))
        job.path(a).write_text(json.dumps(data, indent=2, default=str))


# ----------------------------------------------------------------------------- main


def main() -> None:
    load_dotenv(Path(__file__).with_name(".env"))
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("csv", help="CSV with asset, sponsor and optional focus_indication columns")
    p.add_argument("--out", default="out", help="output folder (default: out)")
    p.add_argument("--limit", type=int, help="only the first N assets, for a pilot")
    p.add_argument("--no-connectors", action="store_true", help="web research only, without the free data connectors (needed for zero-data-retention orgs whose agreement does not cover them)")
    p.add_argument("--render-only", action="store_true", help="re-run the registry checks and re-render saved research, without calling Parallel")
    args = p.parse_args()

    render.ensure_pdf_support()
    assets = read_assets(args.csv)[: args.limit]
    job = Job(Path(args.out))

    if not args.render_only:
        if not os.environ.get("PARALLEL_API_KEY"):
            sys.exit("Set PARALLEL_API_KEY in your environment or in a .env file (see .env.example).")
        from parallel import AuthenticationError, Parallel

        n, k = len(assets), len(spec.SECTIONS)
        cost = n * (k * PRICE[SECTION_PROCESSOR] + PRICE[OUTLOOK_PROCESSOR] + PRICE["extract"] + PRICE["images"])
        print(f"Researching {n} assets with {n * (k + 1)} Task runs, about ${cost:.2f} at list prices (connectors are free)")
        try:
            client = Parallel()
            research(client, job, assets, connectors=not args.no_connectors)
            copy_labels(client, job, assets)
            find_images(client, job, assets)
        except AuthenticationError:
            sys.exit("Parallel rejected PARALLEL_API_KEY. Check the key at https://platform.parallel.ai.")

    for a in assets:
        if not job.path(a).exists():
            continue
        data = json.loads(job.path(a).read_text())
        data["checks"] = checks.run_all(data)
        job.path(a).write_text(json.dumps(data, indent=2, default=str))
        failed = [c for c in data["checks"]["results"] if c["result"] == "fail"]
        print(f"{a['asset']}: {data['checks']['passed']}/{data['checks']['total']} checks passed" + (f", {len(failed)} to review" if failed else ""))
        for c in failed:
            print(f"    !  {c['check']}: {c['detail']}")

    written, incomplete = render.render_all(job.out, assets)
    print(f"Wrote {len(written)} profiles to {job.out / 'pdf'}" + (f" and {job.out / 'profiles.pdf'}" if written else ""))
    if incomplete:
        sys.exit(f"Incomplete output for {', '.join(incomplete)}. Check the saved research and render errors above.")


if __name__ == "__main__":
    main()
