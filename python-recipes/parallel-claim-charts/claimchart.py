"""Evidence-of-use patent claim charts, researched with Parallel, verified in Python, rendered to PDF.

    uv run claimchart.py patents.csv                 # research, verify and render every row
    uv run claimchart.py patents.csv --limit 2       # pilot on the first two rows
    uv run claimchart.py patents.csv --render-only   # re-render saved results, no API calls

Each CSV row names a patent and a product (patent_number, product, company, optional note):

  1. claims     Extract reads the Google Patents page; claim 1 is copied and split into elements
  2. research   one Task run (pro) per row finds evidence for every element, patent databases excluded;
                one Task run (pro) per patent finds non-patent prior art from before the priority date
  3. verify     Extract re-reads every cited page (a copy at most a day old) and Python checks every
                quote, source, date and reference against it
  4. render     one PDF chart per row, a combined book with an exhibit index, and portfolio.csv

Results land in <out>/data/<row>.json, so --render-only rebuilds every PDF without calling the API.
The Task Group id is saved to <out>/runs.json before anything is submitted and every run is tagged with its
row, so rerunning the same command resumes the same runs instead of paying for new ones.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import string
import sys
import time
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

ROOT = Path(__file__).parent
PROCESSOR = "pro"
PRICE_PER_RUN = 0.10  # pro, https://docs.parallel.ai/getting-started/pricing
POLL_SECONDS = 15
RECORD_FETCH = {"max_age_seconds": 7 * 86_400, "timeout_seconds": 60}  # patent status at most a week old
SOURCE_FETCH = {"max_age_seconds": 86_400, "timeout_seconds": 30}  # quotes checked against copies at most a day old
PATENT_SITES = ["patents.google.com", "patentimages.storage.googleapis.com", "uspto.gov", "freepatentsonline.com",
                "patents.justia.com", "lens.org", "espacenet.com", "patentscope.wipo.int"]


# ----------------------------------------------------------------------------- research specs


def spec(item: dict, field: str, about: str, description: str) -> dict:
    """A task spec whose output is one array of `item` objects."""
    item = {"type": "object", "properties": item, "required": list(item), "additionalProperties": False}
    schema = {"type": "object", "description": description, "additionalProperties": False, "required": [field],
              "properties": {field: {"type": "array", "items": item, "description": about}}}
    return {"output_schema": {"type": "json", "json_schema": schema}}


EVIDENCE = spec(
    {
        "element_id": {"type": "string", "description": "The element label exactly as given, e.g. 1[a]."},
        "assessment": {"type": "string", "enum": ["documented", "partial", "not_found"], "description":
                       "documented: a public source describes the product doing what this element requires. "
                       "partial: a source describes related behavior but leaves a gap; say what the gap is. "
                       "not_found: no public source found."},
        "quote": {"type": "string", "description": "Verbatim sentence(s) copied exactly from the source page, 60 words or fewer. "
                  "Do not paraphrase, abridge or stitch sentences together. Empty string if not_found."},
        "source_url": {"type": "string", "description": "URL of the page the quote is copied from: product documentation, "
                       "support or developer pages, manuals, reviews, teardowns or court records. Never a patent document. "
                       "Empty string if not_found."},
        "source_title": {"type": "string", "description": "Title of that page."},
        "source_date": {"type": "string", "description": "Publication or last-updated date of that page as YYYY-MM-DD, "
                        "YYYY-MM or YYYY. Empty string if the page shows no date."},
        "evidence_summary": {"type": "string", "description": "One or two sentences on what the product does that maps to "
                             "this element, and any gap. No legal conclusions."},
    },
    "elements", "One entry per claim element, in the order given, covering every element.",
    "Evidence-of-use research for one patent claim and one product. For each claim element, find public evidence "
    "of how the product works, preferring sources dated within the patent term. Gather evidence only; do not "
    "conclude infringement or validity.",
)

PRIOR_ART = spec(
    {
        "title": {"type": "string", "description": "Title of the document."},
        "author_or_publisher": {"type": "string", "description": "Authors, or the publisher if no author is named."},
        "publication_date": {"type": "string", "description": "Date the document became publicly available, as YYYY-MM-DD, "
                             "YYYY-MM or YYYY only. Use the printed date, or the earliest archive capture if none is printed."},
        "url": {"type": "string", "description": "URL of the document itself. Archived copies are fine."},
        "elements_disclosed": {"type": "string", "description": "Comma-separated labels of the claim elements this document "
                               "discloses, e.g. 1[a], 1[c]."},
        "quote": {"type": "string", "description": "Verbatim passage from the document showing its most important disclosure, 60 words or fewer."},
    },
    "references", "Up to five non-patent references, strongest first.",
    "Non-patent prior art search for one patent claim. Only documents published BEFORE the priority date count. "
    "Exclude patents and patent applications.",
)


# ----------------------------------------------------------------------------- 1. claims


def norm(text: str) -> str:
    """Lowercase words and digits only, so typography and markup never decide a match."""
    text = text.translate(str.maketrans("‘’“”–—", "''\"\"--", "­"))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def first(pattern: str, text: str) -> str | None:
    m = re.search(pattern, text)
    return m.group(1).strip() if m else None


def parse_patent(md: str) -> dict:
    """Read a Google Patents page (Extract markdown) into metadata and claim 1 elements. No model is involved."""
    pa = md.find("Priority Applications")
    claims = md[m.start():] if (m := re.search(r"#+ Claims \(", md)) else ""
    claim1 = re.search(r"\n1\\?\.\s+(.*?)(?=\n\s*2\\?\.\s)", claims, re.S)
    lines = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", claim1.group(1))] if claim1 else []
    return {
        "assignee": first(r"Current Assignee[^\n]*\n\s+([^\n]+)", md),
        "priority_date": first(r"(\d{4}-\d{2}-\d{2})", md[pa:pa + 2000]) if pa >= 0 else None,
        "grant_date": first(r"(\d{4}-\d{2}-\d{2})\s+Application granted", md),
        "expiration": first(r"(\d{4}-\d{2}-\d{2})\s+Anticipated expiration", md),
        "status": first(r"\n\s*Status\s+([^\n]+?)(?:\s+legal-status[^\n]*)?\n", md),
        "claim_count": int(first(r"Claims \(\s*(\d+)\s*\)", md) or 0) or None,
        "elements": split_elements([line for line in lines if line]),
    }


def split_elements(lines: list[str]) -> list[dict]:
    """Group claim lines into chart elements labelled 1[pre], 1[a], 1[b] ..."""
    if not lines:
        return []
    out, buf = [{"id": "1[pre]", "text": lines[0]}], []
    for line in lines[1:]:
        buf.append(line)
        if not line.rstrip().endswith(","):  # a clause ending in a comma continues into the next line
            out.append({"id": f"1[{string.ascii_lowercase[len(out) - 1]}]", "text": " ".join(buf)})
            buf = []
    if buf:
        out.append({"id": f"1[{string.ascii_lowercase[len(out) - 1]}]", "text": " ".join(buf)})
    return out


def patent_checks(pn: str, title: str, record: dict, page: str) -> list[dict]:
    page = norm(page)
    els = record["elements"]
    dates = [record[k] for k in ("priority_date", "grant_date", "expiration")]
    return [
        check("Patent number matches the page", pn.lower() in title.lower(), detail=title.split(" - ")[0]),
        check("Claim 1 copied verbatim", len(els) >= 2 and all(norm(e["text"]) in page for e in els),
              detail=f"{len(els)} elements, each found on the page"),
        check("Dates parsed and in order", all(dates) and dates == sorted(dates), detail=" ≤ ".join(d or "?" for d in dates)),
    ]


def fetch_patents(client, pns: list[str]) -> dict[str, dict]:
    urls = {pn: f"https://patents.google.com/patent/{pn}/en" for pn in pns}
    found = {}
    for i in range(0, len(pns), 20):  # Extract takes up to 20 URLs per request
        r = client.extract(urls=[urls[pn] for pn in pns[i:i + 20]],
                           advanced_settings={"full_content": True, "fetch_policy": RECORD_FETCH})
        found |= {res.url: res for res in r.results}
    records = {}
    for pn, url in urls.items():
        res = found.get(url)
        if not res or not res.full_content:
            records[pn] = {"patent_number": pn, "url": url, "error": "Google Patents page could not be read"}
            continue
        record = parse_patent(res.full_content)
        record |= {"patent_number": pn, "url": url, "title": res.title.split(" - ", 1)[-1].replace("- Google Patents", "").strip(),
                   "fetched": day(res.acquired_at)}
        record["checks"] = patent_checks(pn, res.title, record, res.full_content)
        records[pn] = record
    return records


# ----------------------------------------------------------------------------- 2. research


def evidence_run(row: dict, record: dict) -> dict:
    return {
        "input": {
            "patent_number": row["patent_number"],
            "patent_title": record["title"],
            "patent_term": f"{record['grant_date']} to {record['expiration']}",
            "product": row["product"],
            "company": row["company"],
            "claim_elements": "\n".join(f"{e['id']} {e['text']}" for e in record["elements"]),
        },
        "processor": PROCESSOR,
        "task_spec": EVIDENCE,
        "source_policy": {"exclude_domains": PATENT_SITES},
    }


def prior_art_run(record: dict) -> dict:
    return {
        "input": {
            "patent_number": record["patent_number"],
            "patent_title": record["title"],
            "priority_date": record["priority_date"],
            "claim_1": "\n".join(f"{e['id']} {e['text']}" for e in record["elements"]),
        },
        "processor": PROCESSOR,
        "task_spec": PRIOR_ART,
    }


def research(client, runs: dict[str, dict], state_path: Path) -> dict[str, dict]:
    """Run every task in one Task Group and return {key: result}.

    The group id is saved before anything is submitted, and every run carries its key in metadata, so a rerun
    finds the runs already in the group and submits only the missing ones: nothing is lost or paid for twice.
    """
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if not state.get("group"):
        state["group"] = client.task_group.create(metadata={"recipe": "parallel-claim-charts"}).task_group_id
        state_path.write_text(json.dumps(state, indent=2))
    group = state["group"]
    existing = {(e.run.metadata or {}).get("key"): e.run.run_id for e in client.task_group.get_runs(group) if e.type == "task_run.state"}
    new = [k for k in runs if k not in existing]
    if new:
        inputs = [runs[k] | {"metadata": {"key": k}} for k in new]
        ids = client.with_options(max_retries=0).task_group.add_runs(group, inputs=inputs).run_ids
        existing |= dict(zip(new, ids, strict=True))
    wanted = {existing[k]: k for k in runs}
    print(f"  {len(wanted)} Task runs in group {group}: {len(new)} new, about ${len(new) * PRICE_PER_RUN:.2f} at list prices")
    started = time.time()
    while True:
        status = {e.run.run_id: e.run.status for e in client.task_group.get_runs(group) if e.type == "task_run.state"}
        done = sum(status.get(i) in ("completed", "failed", "cancelled") for i in wanted)
        print(f"  {time.strftime('%H:%M:%S')}  {done}/{len(wanted)} finished  ({(time.time() - started) / 60:.1f} min)", flush=True)
        if done == len(wanted):
            break
        time.sleep(POLL_SECONDS)
    results = {}
    for e in client.task_group.get_runs(group, include_output=True):
        if e.type == "task_run.state" and e.run.run_id in wanted:
            results[wanted[e.run.run_id]] = {
                "run_id": e.run.run_id, "status": e.run.status, "processor": e.run.processor,
                "content": e.output.content if e.output else None,
                "basis": [b.model_dump() for b in e.output.basis] if e.output else [],
            }
    return results


# ----------------------------------------------------------------------------- 3. verify


def check(name: str, ok: bool | None, warn: bool = False, detail: str = "") -> dict:
    """ok=True passes, ok=False fails (or warns when warn=True), ok=None means not applicable."""
    status = "n/a" if ok is None else "pass" if ok else "warn" if warn else "fail"
    return {"name": name, "status": status, "detail": detail}


def day(value) -> str | None:
    return str(value)[:10] if value else None


def domain(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def is_patent_source(url: str) -> bool:
    host = domain(url)
    return any(host == d or host.endswith("." + d) for d in PATENT_SITES)


def parse_date(value: str) -> str | None:
    """'2017-06-30', '2017-06' or '2017' if the value is a real calendar date, else None."""
    value = (value or "").strip()[:10]
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            datetime.strptime(value, fmt)
            return value
        except ValueError:
            continue
    return None


def before(value: str, limit: str) -> bool | None:
    """True if a (possibly partial) date is strictly before `limit`, None if they share the period."""
    limit = limit[:len(value)]
    return True if value < limit else None if value == limit else False


def quote_match(quote: str, page: str) -> float:
    """Share of the quote's 6-word runs found on the page: 1.0 is verbatim."""
    words = norm(quote).split()
    if not words or not page:
        return 0.0
    if len(words) < 6:
        return 1.0 if " ".join(words) in page else 0.0
    runs = [" ".join(words[i:i + 6]) for i in range(len(words) - 5)]
    return sum(r in page for r in runs) / len(runs)


def quote_check(quote: str, url: str, pages: dict) -> dict:
    page = pages.get(url) or {}
    if not page.get("text"):
        return check("Quote found on the page", False, warn=True, detail="page could not be fetched; check by hand")
    share = quote_match(quote, page["text"])
    copy = f"copy of {page['fetched']}"
    if share >= 0.95 and page.get("stale"):
        return check("Quote found on the page", False, warn=True, detail=f"verbatim on an older {copy}; a fresh copy was not available")
    if share >= 0.95:
        return check("Quote found on the page", True, detail=f"verbatim, {copy}")
    if share >= 0.6:
        return check("Quote found on the page", False, warn=True, detail=f"{share:.0%} of the wording matches, {copy}")
    return check("Quote found on the page", False, detail=f"not on the page, {copy}")


def fetch_pages(client, urls: set[str]) -> dict[str, dict]:
    """Fetch every cited page once, fresh, and keep its normalized text for the quote checks."""
    pages, urls = {}, sorted(u for u in urls if u)
    for i in range(0, len(urls), 20):
        try:
            r = client.extract(urls=urls[i:i + 20], advanced_settings={"full_content": True, "fetch_policy": SOURCE_FETCH})
        except Exception as exc:  # one bad batch should not stop the others
            print(f"  Extract failed for {len(urls[i:i + 20])} pages: {exc}")
            continue
        for res in r.results:
            text = norm(res.full_content or "")
            fetched = day(res.acquired_at) if text else None  # an empty copy was not really visited
            stale = bool(fetched) and (date.today() - date.fromisoformat(fetched)).days > 2  # live fetch failed, cache was used
            pages[res.url] = {"text": text, "fetched": fetched, "stale": stale, "published": day(res.publish_date)}
    return pages


def verify_evidence(record: dict, result: dict, pages: dict, today: str) -> list[dict]:
    """One row per claim element: the research, its basis and every check, in claim order."""
    content = result.get("content") or {}
    by_id = {}
    for i, item in enumerate(content.get("elements", [])):
        basis = next((b for b in result["basis"] if b["field"] == f"elements.{i}"), {})
        basis = {"confidence": basis.get("confidence"), "reasoning": basis.get("reasoning"),
                 "citations": [{"url": c["url"], "title": c.get("title")} for c in basis.get("citations") or []]}
        by_id.setdefault(item["element_id"], item | {"basis": basis})
    rows = []
    for el in record["elements"]:
        item = by_id.get(el["id"])
        if not item:
            rows.append({**el, "assessment": "not_found", "checks": [check("Element researched", False, detail="missing from the research output")]})
            continue
        url, quote, found = item["source_url"].strip(), item["quote"].strip(), item["assessment"] != "not_found"
        cited = {c["url"] for c in item["basis"].get("citations") or []}
        page = pages.get(url) or {}
        dated, date_from = parse_date(item["source_date"]), "the research"
        if not item["source_date"] and parse_date(page.get("published")):  # fall back to the page's own metadata
            dated, date_from = page["published"], "the page's metadata"
        checks = [
            check("Element researched", True, detail=el["id"]),
            check("Quote and source given", bool(url and quote) == found, detail="as required by the assessment"),
        ]
        if found and url:
            checks += [
                quote_check(quote, url, pages),
                check("Not a patent document", not is_patent_source(url), detail=domain(url)),
                check("Source cited in the research basis", url in cited, warn=True,
                      detail="listed among the citations" if url in cited else "not among this element's citations"),
                check("Source dated", bool(dated) and dated <= today, warn=not dated and not item["source_date"],
                      detail=f"{dated}, from {date_from}" if dated else "no date on the page" if not item["source_date"]
                      else f"invalid date {item['source_date']!r}"),
            ]
        rows.append({**el, **item, "source_date": dated or "", "fetched": page.get("fetched"), "domain": domain(url) if url else "",
                     "term": term_label(dated, record), "checks": checks})
    return rows


def term_label(dated: str | None, record: dict) -> str:
    """Where a source date falls against the patent term; a shared partial period counts as during."""
    grant, expiry = record["grant_date"], record["expiration"]
    if not dated:
        return ""
    if grant and dated < grant[:len(dated)]:
        return "before the patent issued"
    if expiry and dated > expiry[:len(dated)]:
        return "after the patent expired"
    return "during the patent term"


def verify_prior_art(record: dict, result: dict, pages: dict) -> tuple[list[dict], list[dict]]:
    """Split references into accepted and rejected; a reference is rejected if any check fails."""
    ids = {e["id"] for e in record["elements"]}
    accepted, rejected = [], []
    for ref in (result.get("content") or {}).get("references", []):
        raw = ref["publication_date"].strip()
        dated, noted = parse_date(raw), None
        if not dated:  # e.g. "Not printed; publicly archived on 2004-07-29": use the date, flag it for a person
            noted = dated = first(r"(\d{4}-\d{2}-\d{2})", raw)
        early = before(dated, record["priority_date"]) if dated else False
        labels = re.findall(r"1\[(?:pre|[a-z])\]", ref["elements_disclosed"])
        detail = f"{dated or 'undated'} vs priority {record['priority_date']}"
        if early is None:
            detail += ", same period: check by hand"
        elif noted and early:
            detail += f", read from the note “{raw}”: check by hand"
        checks = [
            check("Published before the priority date", bool(early) and not noted, warn=early is None or bool(noted), detail=detail),
            check("Not a patent document", not is_patent_source(ref["url"]) and not re.search(r"\b(US|EP|WO)\s?\d{6,}", ref["title"]), detail=domain(ref["url"])),
            quote_check(ref["quote"], ref["url"], pages),
            check("Element labels match the claim", bool(labels) and set(labels) <= ids, warn=True, detail=", ".join(labels) or "none"),
        ]
        if checks[2]["status"] == "fail":  # flag, don't reject: paywalled papers often hide their full text
            checks[2]["status"] = "warn"
        page = pages.get(ref["url"]) or {}
        row = ref | {"publication_date": dated or ref["publication_date"], "labels": labels, "domain": domain(ref["url"]),
                     "fetched": page.get("fetched"), "checks": checks}
        (rejected if any(c["status"] == "fail" for c in checks) else accepted).append(row)
    return accepted, rejected


# ----------------------------------------------------------------------------- 4. render


def ensure_pdf_support() -> None:
    """Import WeasyPrint, pointing macOS at Homebrew's Pango if needed."""
    try:
        import weasyprint  # noqa: F401
    except OSError:
        homebrew = next((d for d in ("/opt/homebrew/lib", "/usr/local/lib") if Path(d, "libpango-1.0.0.dylib").exists()), None)
        if sys.platform == "darwin" and homebrew and "DYLD_FALLBACK_LIBRARY_PATH" not in os.environ:
            # dyld reads this variable only at process start, so restart with it set.
            os.execve(sys.executable, [sys.executable, *sys.orig_argv[1:]], {**os.environ, "DYLD_FALLBACK_LIBRARY_PATH": homebrew})
        sys.exit("PDF rendering needs the Pango library.\n  macOS:          brew install pango\n"
                 "  Debian/Ubuntu:  sudo apt install libpango-1.0-0 libpangoft2-1.0-0")


def summarize(chart: dict) -> dict:
    els, refs = chart["elements"], chart["prior_art"]
    checks = chart["patent"]["checks"] + [c for x in els + refs + chart["rejected"] for c in x["checks"]]
    quotes = [c for x in els for c in x["checks"] if c["name"] == "Quote found on the page"]
    return {
        **{k: sum(e["assessment"] == k for e in els) for k in ("documented", "partial", "not_found")},
        "elements": len(els),
        "quotes_verified": sum(c["status"] == "pass" for c in quotes),
        "quotes": len(quotes),
        "sources": len({e["source_url"] for e in els if e.get("source_url")}),
        "checks_passed": sum(c["status"] == "pass" for c in checks),
        "checks_flagged": sum(c["status"] in ("warn", "fail") for c in checks),
        "checks": sum(c["status"] != "n/a" for c in checks),
    }


MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."]


def bluebook_date(value: str | None) -> str:
    """'2026-11-03' becomes 'Nov. 3, 2026' and '2017-06' becomes 'June 2017'; anything else is unchanged."""
    parts = (value or "").split("-")
    if len(parts) == 3:
        return f"{MONTHS[int(parts[1]) - 1]} {int(parts[2])}, {parts[0]}"
    if len(parts) == 2:
        return f"{MONTHS[int(parts[1]) - 1]} {parts[0]}"
    return value or ""


def render_all(out: Path, rows: list[dict]) -> list[Path]:
    from jinja2 import Environment, FileSystemLoader
    from weasyprint import HTML

    env = Environment(loader=FileSystemLoader(ROOT), autoescape=True)
    env.filters["longdate"] = bluebook_date
    env.filters["patno"] = lambda pn: re.sub(r"^US(\d+)([A-Z]\d?)$", lambda m: f"{int(m[1]):,} {m[2]}", pn)
    template = env.get_template("chart.html.j2")
    wordmark = (ROOT / "assets/parallel-wordmark.svg").read_text()
    charts = []
    for n, row in enumerate(rows, 1):
        path = out / "data" / f"{row['key']}.json"
        if path.exists():
            chart = json.loads(path.read_text())
            charts.append(chart | {"exhibit": f"A-{n}", "summary": summarize(chart)})
    (out / "pdf").mkdir(parents=True, exist_ok=True)
    docs, written = [], []
    for chart in charts:
        doc = HTML(string=template.render(charts=[chart], wordmark=wordmark), base_url=str(ROOT)).render()
        doc.write_pdf(out / "pdf" / f"{chart['key']}.pdf")
        docs.append(doc)
        written.append(out / "pdf" / f"{chart['key']}.pdf")
    if docs:
        index = HTML(string=template.render(charts=charts, wordmark=wordmark, index=True), base_url=str(ROOT)).render()
        index.copy([p for d in [index, *docs] for p in d.pages]).write_pdf(out / "claim-charts.pdf")
        with open(out / "portfolio.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["exhibit", "patent_number", "title", "status", "expiration", "product", "elements", "documented",
                        "partial", "not_found", "quotes_verified", "prior_art_refs", "checks_passed", "checks_flagged", "pdf"])
            for c in charts:
                s, p = c["summary"], c["patent"]
                w.writerow([c["exhibit"], p["patent_number"], p["title"], p["status"], p["expiration"], c["row"]["product"],
                            s["elements"], s["documented"], s["partial"], s["not_found"], f"{s['quotes_verified']}/{s['quotes']}",
                            len(c["prior_art"]), s["checks_passed"], s["checks_flagged"], f"pdf/{c['key']}.pdf"])
    return written


# ----------------------------------------------------------------------------- main


def read_rows(path: str) -> list[dict]:
    with open(path, newline="") as f:
        rows = [{k: (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]
    for r in rows:
        if not r.get("patent_number") or not r.get("product"):
            sys.exit(f"Every row needs patent_number and product: {r}")
        r["patent_number"] = r["patent_number"].replace(",", "").replace(" ", "").upper()
        r["key"] = f"{r['patent_number']}--{re.sub(r'[^a-z0-9]+', '-', r['product'].lower()).strip('-')[:40]}"
    return rows


def build(client, rows: list[dict], out: Path) -> None:
    today = date.today().isoformat()
    (out / "data").mkdir(parents=True, exist_ok=True)
    print(f"1/4  Reading claim 1 of {len({r['patent_number'] for r in rows})} patents from Google Patents")
    patents = fetch_patents(client, sorted({r["patent_number"] for r in rows}))
    for pn, p in patents.items():
        failed = p.get("error") or next((c["name"] for c in p["checks"] if c["status"] == "fail"), None)
        if failed:
            print(f"  Skipping {pn}: {failed}")
    ok = [r for r in rows if not patents[r["patent_number"]].get("error")
          and all(c["status"] != "fail" for c in patents[r["patent_number"]]["checks"])]

    runs = {f"evidence:{r['key']}": evidence_run(r, patents[r["patent_number"]]) for r in ok}
    runs |= {f"prior_art:{pn}": prior_art_run(patents[pn]) for pn in sorted({r["patent_number"] for r in ok})}
    print(f"2/4  Researching {len(ok)} charts with {len(runs)} {PROCESSOR} Task runs")
    results = research(client, runs, out / "runs.json")

    urls = {e["source_url"] for k, v in results.items() if k.startswith("evidence:") for e in (v["content"] or {}).get("elements", [])}
    urls |= {x["url"] for k, v in results.items() if k.startswith("prior_art:") for x in (v["content"] or {}).get("references", [])}
    print(f"3/4  Checking quotes against fresh copies of {len(urls)} pages")
    pages = fetch_pages(client, urls)

    for r in ok:
        record, ev, pa = patents[r["patent_number"]], results[f"evidence:{r['key']}"], results[f"prior_art:{r['patent_number']}"]
        accepted, rejected = verify_prior_art(record, pa, pages)
        chart = {
            "key": r["key"], "row": r, "patent": record, "checked": today,
            "elements": verify_evidence(record, ev, pages, today), "prior_art": accepted, "rejected": rejected,
            "runs": {"evidence": ev["run_id"], "prior_art": pa["run_id"], "processor": ev["processor"]},
            "status": {"evidence": ev["status"], "prior_art": pa["status"]},
        }
        (out / "data" / f"{r['key']}.json").write_text(json.dumps(chart, indent=2, ensure_ascii=False))


def main() -> None:
    load_dotenv(ROOT / ".env")
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("csv", help="CSV with patent_number, product, company and optional note columns")
    p.add_argument("--out", default="out", help="output folder (default: out)")
    p.add_argument("--limit", type=int, help="only the first N rows, for a pilot")
    p.add_argument("--render-only", action="store_true", help="re-render saved results without calling the API")
    args = p.parse_args()

    ensure_pdf_support()
    rows, out = read_rows(args.csv)[: args.limit], Path(args.out)
    if not args.render_only:
        if not os.environ.get("PARALLEL_API_KEY"):
            sys.exit("Set PARALLEL_API_KEY in your environment or in a .env file (see .env.example).")
        from parallel import Parallel

        build(Parallel(), rows, out)
    print("4/4  Rendering")
    written = render_all(out, rows)
    print(f"Wrote {len(written)} claim charts to {out / 'pdf'}, plus {out / 'claim-charts.pdf'} and {out / 'portfolio.csv'}")
    if len(written) < len(rows):
        sys.exit(f"{len(rows) - len(written)} rows have no chart. See the messages above.")


if __name__ == "__main__":
    main()
