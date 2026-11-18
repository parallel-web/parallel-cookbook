"""Deterministic checks: every identifier a run reports is looked up in its public registry. No model is involved.

  ClinicalTrials.gov API v2   NCT IDs resolve, with the phase, status, sponsor, enrollment and dates the run reported
  PubMed E-utilities          PMIDs resolve, with the journal and year the run reported
  openFDA Drugs@FDA           the NDA or BLA resolves to this drug, with the first approval date the run reported
  DailyMed                    the label set ID resolves to this drug; its printed revision date matches
  arithmetic                  each effect estimate sits inside its 95% CI, and the P value agrees with the CI
  dates                       approval, conversion and trial dates are in order and not in the future
  consistency                 sections agree: brands need approvals, and approvals or rejections in the news
                              appear in the regulatory section

It also finds the latest expiry date among the listed US exclusivities and patents.
"""

from __future__ import annotations

import re
from datetime import date, datetime

import httpx

HTTP = httpx.Client(timeout=30, headers={"User-Agent": "parallel-drug-profiles/0.1"}, follow_redirects=True)
CTGOV = "https://clinicaltrials.gov/api/v2/studies/{}"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
OPENFDA = "https://api.fda.gov/drug/drugsfda.json"
DAILYMED = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{}/history.json"

PHASES = {
    ("PHASE1",): "phase 1", ("PHASE1", "PHASE2"): "phase 1/2", ("PHASE2",): "phase 2",
    ("PHASE2", "PHASE3"): "phase 2/3", ("PHASE3",): "phase 3", ("PHASE4",): "phase 4",
}
RATIOS = {"hazard ratio", "odds ratio", "risk ratio", "rate ratio"}


# ----------------------------------------------------------------------------- helpers


def parse_date(text: str | None) -> tuple[date, int] | None:
    """A date and its precision (3 = day, 2 = month, 1 = year), from YYYY-MM-DD, YYYY-MM, YYYY, YYYYMMDD or 'Jul 27, 2026'."""
    text = (text or "").strip()
    for fmt, precision in (("%Y-%m-%d", 3), ("%Y%m%d", 3), ("%b %d, %Y", 3), ("%B %d, %Y", 3), ("%Y-%m", 2), ("%Y", 1)):
        try:
            return datetime.strptime(text, fmt).date(), precision
        except ValueError:
            continue
    return None


def same_date(a: str | None, b: str | None) -> bool | None:
    """Whether two dates agree at the precision of the less precise one. None if either is missing."""
    pa, pb = parse_date(a), parse_date(b)
    if not pa or not pb:
        return None
    precision = min(pa[1], pb[1])
    key = lambda d: (d.year, d.month, d.day)[:precision]
    return key(pa[0]) == key(pb[0])


def words(text: str) -> set[str]:
    stop = {"inc", "co", "ltd", "llc", "corp", "corporation", "company", "the", "and", "of", "pharma", "pharmaceuticals", "pharmaceutical", "ag", "sa", "plc", "gmbh", "limited"}
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w not in stop}


def result(check: str, subject: str, ok: bool | None, detail: str, ref: str = "") -> dict:
    """One check. ref is the identifier checked (an NCT ID or PMID), so the PDF can mark that row."""
    return {"check": check, "subject": subject, "result": "skip" if ok is None else ("pass" if ok else "fail"), "detail": detail, "ref": ref}


def get_json(url: str, **params) -> dict | None:
    try:
        r = HTTP.get(url, params=params or None)
        return r.json() if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None


# ----------------------------------------------------------------------------- ClinicalTrials.gov


def check_trial(t: dict, section: str) -> list[dict]:
    nct = (t.get("nct_id") or "").strip().upper()
    subject = f"{section}: {t.get('acronym') or nct or t.get('other_registry_id') or 'unnamed trial'}"
    if not nct:
        return [result("trial registered on ClinicalTrials.gov", subject, None, f"no NCT ID (other registry: {t.get('other_registry_id') or 'none'})")]
    if not re.fullmatch(r"NCT\d{8}", nct):
        return [result("NCT ID resolves", subject, False, f"{nct!r} is not a valid NCT ID", nct)]
    study = get_json(CTGOV.format(nct))
    if not study:
        return [result("NCT ID resolves", subject, False, f"{nct} not found on ClinicalTrials.gov", nct)]
    p = study["protocolSection"]
    status, design, sponsor = p.get("statusModule", {}), p.get("designModule", {}), p.get("sponsorCollaboratorsModule", {})
    reg_phase = PHASES.get(tuple(design.get("phases") or []), "/".join(design.get("phases") or []) or "n/a")
    reg_status = (status.get("overallStatus") or "").replace("_", " ").lower().replace("active not", "active, not")
    reg_sponsor = (sponsor.get("leadSponsor") or {}).get("name", "")
    reg_enroll = (design.get("enrollmentInfo") or {}).get("count")
    reg_pcd = (status.get("primaryCompletionDateStruct") or {}).get("date")
    title = p.get("identificationModule", {}).get("briefTitle", "")
    out = [result("NCT ID resolves", subject, True, f"{nct}: {title}", nct)]
    out.append(result("trial phase matches registry", subject, t.get("phase") == reg_phase, f"run: {t.get('phase')}; registry: {reg_phase}", nct))
    out.append(result("trial status matches registry", subject, t.get("status") == reg_status, f"run: {t.get('status')}; registry: {reg_status}", nct))
    out.append(result("lead sponsor matches registry", subject, bool(words(t.get("lead_sponsor", "")) & words(reg_sponsor)), f"run: {t.get('lead_sponsor')}; registry: {reg_sponsor}", nct))
    if t.get("enrollment") is not None and reg_enroll:
        ok = abs(float(t["enrollment"]) - reg_enroll) <= 0.05 * reg_enroll
        out.append(result("enrollment matches registry (within 5%)", subject, ok, f"run: {t['enrollment']:g}; registry: {reg_enroll}", nct))
    out.append(result("primary completion date matches registry", subject, same_date(t.get("primary_completion_date"), reg_pcd), f"run: {t.get('primary_completion_date')}; registry: {reg_pcd}", nct))
    start, pcd = parse_date(t.get("start_date")), parse_date(t.get("primary_completion_date"))
    if start and pcd:
        out.append(result("trial starts before primary completion", subject, start[0] <= pcd[0], f"{t.get('start_date')} -> {t.get('primary_completion_date')}", nct))
    return out


# ----------------------------------------------------------------------------- PubMed and effect sizes


def p_value(text: str) -> tuple[str, float] | None:
    """('<', 0.001) from 'P<0.001', ('=', 0.03) from '0.03', ('<', 0.0001) from 'one-sided p<0·0001' (Lancet decimal point)."""
    text = (text or "").replace("·", ".").replace(",", ".")
    m = re.search(r"([<>=≤≥]?)\s*(\d*\.?\d+(?:\s*[x×]\s*10\s*[-−–]\s*\d+|e[-−–]?\d+)?)\s*$", text, re.I)
    if not m:
        return None
    num = m.group(2).replace(" ", "").replace("−", "-").replace("–", "-")
    if re.search(r"[x×]10", num):
        base, exp = re.split(r"[x×]10", num)
        value = float(base) * 10 ** int(exp)
    else:
        value = float(num)
    return (m.group(1).replace("≤", "<").replace("≥", ">") or "="), value


def check_results(results: list[dict]) -> list[dict]:
    out = []
    pmids = [r["pmid"].strip() for r in results if re.fullmatch(r"\d{5,9}", (r.get("pmid") or "").strip())]
    summary = (get_json(EUTILS, db="pubmed", id=",".join(pmids), retmode="json") or {}).get("result", {}) if pmids else {}
    for r in results:
        subject = f"evidence: {r.get('trial')}"
        pmid = (r.get("pmid") or "").strip()
        if not pmid:
            out.append(result("result published in a journal", subject, None, "no PMID reported", pmid))
        else:
            rec = summary.get(pmid) or {}
            if not rec or rec.get("error"):
                out.append(result("PMID resolves", subject, False, f"PMID {pmid} not found on PubMed", pmid))
            else:
                out.append(result("PMID resolves", subject, True, f"{pmid}: {rec.get('title', '')[:120]}", pmid))
                years = {(rec.get("pubdate") or "")[:4], (rec.get("epubdate") or "")[:4]} - {""}  # print or online-first year
                if r.get("publication_year"):
                    shown = rec.get("pubdate") + (f" (online {rec.get('epubdate')})" if rec.get("epubdate") else "")
                    out.append(result("publication year matches PubMed", subject, str(int(r["publication_year"])) in years, f"run: {r['publication_year']:g}; PubMed: {shown}", pmid))
                journals = words(rec.get("source", "")) | words(rec.get("fulljournalname", ""))
                ok = bool(words(r.get("journal", ""))) and words(r.get("journal", "")) <= journals
                out.append(result("journal matches PubMed", subject, ok, f"run: {r.get('journal')}; PubMed: {rec.get('source')}", pmid))
        est, lo, hi = r.get("estimate"), r.get("ci_lower"), r.get("ci_upper")
        if None in (est, lo, hi):
            out.append(result("estimate inside its 95% CI", subject, None, "estimate or CI not reported"))
            continue
        lo, hi = min(lo, hi), max(lo, hi)
        out.append(result("estimate inside its 95% CI", subject, lo <= est <= hi, f"{est:g} (95% CI {lo:g} to {hi:g})"))
        null = 1.0 if r.get("effect_measure") in RATIOS else 0.0 if r.get("effect_measure") != "other" else None
        pv = p_value(r.get("p_value", ""))
        if null is None or pv is None:
            out.append(result("P value agrees with the 95% CI", subject, None, f"P {r.get('p_value') or 'not reported'}; measure {r.get('effect_measure')}"))
            continue
        excludes_null = not (lo <= null <= hi)
        op, value = pv
        alpha = 0.025 if "one-sided" in (r.get("p_value") or "").lower() else 0.05  # a two-sided 95% CI pairs with one-sided alpha 0.025
        significant = value < alpha or (op == "<" and value <= alpha)
        boundary = op == "=" and 0.04 <= value <= 0.06 or lo == null or hi == null  # rounding at the edge
        ok = True if boundary else (excludes_null == significant)
        out.append(result("P value agrees with the 95% CI", subject, ok, f"{r.get('p_value')}; CI {'excludes' if excludes_null else 'includes'} {null:g}"))
    return out


# ----------------------------------------------------------------------------- FDA and DailyMed


def check_us(us: dict, identity: dict, label: dict) -> list[dict]:
    out, subject = [], "regulatory: United States"
    names = words(identity.get("generic_name", "")) | {w for b in identity.get("brand_names", []) for w in words(b.get("name", ""))}
    app = re.sub(r"\s+", "", (us.get("application_number") or "").upper())
    if us.get("status") != "approved":
        # Drugs@FDA lists approved applications only, so an application under review cannot be checked there.
        return [result("FDA application resolves", subject, None, f"status: {us.get('status')}; {app or 'no application number'} not checkable until approved")]
    m = re.fullmatch(r"(NDA|BLA|ANDA)(\d{6})", app)
    if not m:
        out.append(result("FDA application resolves", subject, False, f"{app!r} is not an NDA/BLA number"))
    else:
        found = (get_json(OPENFDA, search=f'application_number:"{app}"', limit=1) or {}).get("results", [])
        if not found:
            out.append(result("FDA application resolves", subject, False, f"{app} not in Drugs@FDA"))
        else:
            rec = found[0]
            fda_names = {w for p in rec.get("products", []) for w in words(p.get("brand_name", ""))}
            fda_names |= {w for k in ("brand_name", "generic_name") for v in (rec.get("openfda") or {}).get(k, []) for w in words(v)}
            out.append(result("FDA application is this drug", subject, bool(names & fda_names), f"{app}: {', '.join(sorted({p.get('brand_name', '') for p in rec.get('products', [])}))}"))
            orig = [s["submission_status_date"] for s in rec.get("submissions", []) if s.get("submission_type") == "ORIG" and s.get("submission_status") == "AP"]
            fda_date = min(orig) if orig else None
            out.append(result("first approval date matches Drugs@FDA", subject, same_date(us.get("first_approval_date"), fda_date), f"run: {us.get('first_approval_date')}; Drugs@FDA: {fda_date}"))
    setid = label.get("setid", "")
    if setid:
        hist = (get_json(DAILYMED.format(setid)) or {}).get("data") or {}
        title = (hist.get("spl") or {}).get("title", "")
        ok = bool(title) and bool(names & words(title))
        latest = (hist.get("history") or [{}])[0]
        out.append(result("DailyMed set ID is this drug", subject, ok, f"{setid}: {title[:90] or 'not found'} (version {latest.get('spl_version')}, published {latest.get('published_date')})"))
        label["dailymed_version"], label["dailymed_published"] = latest.get("spl_version"), latest.get("published_date")
    if label.get("printed_revision"):
        out.append(result("label revision date matches the label", subject, same_date(us.get("label_revision_date"), label["printed_revision"]), f"run: {us.get('label_revision_date')}; label prints: {label['printed_revision']}"))
    if "indications_and_usage" in label:
        ok = bool(label["indications_and_usage"])
        out.append(result("Indications and Usage copied from the label", subject, ok, f"{len(label['indications_and_usage'])} characters copied verbatim" if ok else label.get("status", "section not found")))
    return out


def check_dates(reg: dict) -> list[dict]:
    out, today = [], date.today()
    for region, r in reg.items():
        first = parse_date(r.get("first_approval_date"))
        if first:
            out.append(result("approval date is not in the future", f"regulatory: {region}", first[0] <= today, r["first_approval_date"]))
        for ind in r.get("approved_indications", []):
            d = parse_date(ind.get("approval_date"))
            if first and d:
                # Compare at month precision: indications approved on the first approval date count as in order.
                ok = (d[0].year, d[0].month) >= (first[0].year, first[0].month)
                out.append(result("indication approved on or after first approval", f"regulatory: {region}", ok, f"{ind.get('indication')}: {ind.get('approval_date')} vs first {r['first_approval_date']}"))
        conv = parse_date(r.get("conversion_to_traditional_date"))
        if first and conv:
            out.append(result("accelerated approval converted after it was granted", f"regulatory: {region}", conv[0] >= first[0], f"{r['first_approval_date']} -> {r['conversion_to_traditional_date']}"))
    return out


REGIONS = {"united states": "us", "us": "us", "usa": "us", "european union": "eu", "eu": "eu", "europe": "eu", "china": "china", "japan": "japan"}


def check_consistency(identity: dict, reg: dict, news: dict) -> list[dict]:
    """Sections are researched separately, so check they agree with each other.

    A brand marketed in a region needs an approval there. An approval or rejection the news
    run reports must show up in the regulatory run, which reads only regulator sites.
    """
    out = []
    for b in identity.get("brand_names", []):
        region = REGIONS.get((b.get("region") or "").strip().lower())
        if region and reg.get(region):
            status = reg[region].get("status")
            out.append(result("brand region has an approval", f"identity: {b.get('name')} ({b.get('region')})", status == "approved", f"regulatory status in {region}: {status}"))
    for a in news.get("regulatory_actions", []):
        region, action, when = a.get("region"), a.get("action"), a.get("date")
        r = reg.get(region) or {}
        subject = f"news: {region} {action} {when}"
        kind = news_approval(a, reg)
        if kind == "formulation":
            out.append(result("news approval appears in the regulatory section", subject, None, f"later approval of an already-approved asset: {a.get('detail')}"))
        elif kind:
            dates = [i.get("approval_date") for i in r.get("approved_indications", [])] + [r.get("first_approval_date")]
            out.append(result("news approval appears in the regulatory section", subject, kind == "confirmed", f"{a.get('detail')} | regulatory: {r.get('status')}, indications dated {', '.join(filter(None, dates)) or 'none'}"))
        elif action == "complete response letter" and r and r.get("status") != "approved":
            out.append(result("news rejection matches regulatory status", subject, r.get("status") == "complete response letter", f"{a.get('detail')} | regulatory status: {r.get('status')}"))
    return out


def news_approval(a: dict, reg: dict) -> str | None:
    """How a news-reported approval relates to the regulatory section: confirmed, unconfirmed, formulation, or None if not an approval."""
    region, action, when = a.get("region"), a.get("action"), a.get("date")
    r = reg.get(region) or {}
    if action not in ("approval", "new indication approved") or not r or not parse_date(when):
        return None
    first = parse_date(r.get("first_approval_date"))
    if action == "approval" and first and not same_month_or_adjacent(when, r.get("first_approval_date")) and first[0] < parse_date(when)[0]:
        return "formulation"  # approved long before: a new formulation, dose or regimen, not a first approval or an indication
    dates = [i.get("approval_date") for i in r.get("approved_indications", [])] + [r.get("first_approval_date")]
    near = any(same_month_or_adjacent(when, d) for d in dates)
    return "confirmed" if r.get("status") == "approved" and near else "unconfirmed"


def unconfirmed_approvals(reg: dict, news: dict) -> list[dict]:
    """Approvals the news run reports that the regulator-only run did not find, for the PDF to show with a marker."""
    return [a for a in news.get("regulatory_actions", []) if news_approval(a, reg) == "unconfirmed"]


def same_month_or_adjacent(a: str | None, b: str | None) -> bool:
    """Announcements can trail the regulator's date by days, so allow the neighbouring month."""
    pa, pb = parse_date(a), parse_date(b)
    if not pa or not pb:
        return False
    months = lambda d: d.year * 12 + d.month
    return abs(months(pa[0]) - months(pb[0])) <= 1


def exclusivity(market: dict) -> dict:
    """Summarize reported protection dates without inferring eligibility from a BLA."""
    facts = {}
    ex = market.get("us_exclusivity") or {}
    dated = [(parse_date(e.get("expiry_date")), re.sub(r"(?i)( exclusivity)?$", " exclusivity", e.get("kind") or "", count=1)) for e in ex.get("listed_exclusivities", [])]
    dated += [(parse_date(p.get("expiry_date")), f"US patent {p.get('patent_number')} ({p.get('covers')})") for p in ex.get("patents", [])]
    dated = [(d[0], why) for d, why in dated if d]
    if dated:
        last, why = max(dated)
        facts["last_protection_ends"], facts["last_protection_basis"] = last.isoformat(), why
    reference_dates = [d for d, why in dated if why.casefold() == "reference product exclusivity"]
    if reference_dates:
        facts["reference_product_exclusivity_ends"] = max(reference_dates).isoformat()
    return facts


# ----------------------------------------------------------------------------- label text


def label_section(page: str) -> dict:
    """Copy section 1 of the full prescribing information from an Extract of a DailyMed page, and its printed revision date."""
    text = re.sub(r"\\([^\w\s])", r"\1", page)
    sections = re.findall(
        r"^[ \t*#-]*1[ \t]+INDICATIONS[ \t]+(?:AND|&)[ \t]+USAGE[ \t*]*$"
        r"(.*?)^[ \t*#-]*2[ \t]+DOSAGE[ \t]+AND[ \t]+ADMINISTRATION\b",
        text, re.S | re.M | re.I,
    )
    body = ""
    for section in reversed(sections):
        lines = [re.sub(r"^\s*(?:#+|[*+-])\s+", "", ln).strip() for ln in section.splitlines() if ln.strip()]
        # DailyMed often puts the same section titles in its table of contents.
        if any(not re.match(r"\[?1\.\d+\b", line) for line in lines):
            body = "\n".join(lines)
            break
    rev = re.search(r"Revised:\s*(\d{1,2})/(\d{4})", text)
    return {
        "status": "copied" if body else "section 1 not found on the page",
        "indications_and_usage": body,
        "printed_revision": f"{rev.group(2)}-{int(rev.group(1)):02d}" if rev else "",
    }


# ----------------------------------------------------------------------------- all


def run_all(data: dict) -> dict:
    runs = {k: (v or {}).get("content") or {} for k, v in data["runs"].items()}
    label = data.setdefault("label", {})
    results = []
    for section, key in (("trials", "pivotal_trials"), ("trials", "ongoing_trials")):
        for t in runs.get(section, {}).get(key, []):
            results += check_trial(t, key.replace("_", " "))
    results += check_results(runs.get("evidence", {}).get("pivotal_results", []))
    reg = runs.get("regulatory", {})
    if reg:
        results += check_us(reg.get("us", {}), runs.get("identity", {}), label)
        results += check_dates(reg)
        results += check_consistency(runs.get("identity", {}), reg, runs.get("news", {}))
    computed = exclusivity(runs.get("market", {}))
    counted = [r for r in results if r["result"] != "skip"]
    return {
        "results": results,
        "computed": computed,
        "passed": sum(r["result"] == "pass" for r in counted),
        "total": len(counted),
        "skipped": len(results) - len(counted),
    }
