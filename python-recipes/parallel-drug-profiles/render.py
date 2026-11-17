"""Turn saved research into drug asset profile PDFs. No API calls, no LLM.

Every section headline, the region grid, the forest plots, the exclusivity end date
and the check summary are computed here from the researched facts and the registry
checks, so the same research always renders the same profile.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from datetime import date
from pathlib import Path

from jinja2 import ChainableUndefined, Environment, FileSystemLoader
from markupsafe import Markup

import checks
import spec

ROOT = Path(__file__).parent
MINUS = "−"
INK, INK2, RULE2, CARD, ORANGE = "#1D1B16", "#5C5B59", "#D4D2CA", "#F2F1EE", "#FB631B"
MONO = "'FT System Mono', 'Geist Mono', 'SF Mono', Menlo, monospace"

# Geist is open source and loads from Google Fonts at render time. Parallel's
# licensed brand fonts are used instead when PROFILE_FONT_DIR points at them.
WEB_FONTS = "@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono&display=swap');"
BRAND_FONTS = [
    ("Gerstner Programm", 400, "Gerstner-ProgrammRegular"),
    ("Gerstner Programm", 500, "Gerstner-ProgrammMedium"),
    ("NaN Holo", 500, "NaNHoloStandard-Medium"),
    ("FT System Mono", 400, "FTSystemMono-Regular"),
]

REGIONS = [("us", "United States"), ("eu", "European Union"), ("china", "China"), ("japan", "Japan")]
REGION_SHORT = {"us": "US", "eu": "EU", "china": "China", "japan": "Japan", "other": "Other"}
FIELD_LABELS = {
    "summary": "Summary",
    "generic_name": "Generic name",
    "brand_names": "Brand names",
    "development_codes": "Development codes",
    "originator": "Originator",
    "rights_holders": "Rights holders",
    "modality": "Modality",
    "targets": "Targets",
    "mechanism_of_action": "Mechanism",
    "route": "Route",
    "chembl_id": "ChEMBL ID",
    "highest_stage": "Highest stage",
    "us": "US regulatory status",
    "eu": "EU regulatory status",
    "china": "China regulatory status",
    "japan": "Japan regulatory status",
    "regulatory_actions": "Regulatory actions",
    "pending_decisions": "Pending decisions",
    "recent_developments": "Recent developments",
    "pivotal_trials": "Pivotal trials",
    "ongoing_trials": "Ongoing trials",
    "pivotal_results": "Pivotal results",
    "key_safety": "Key safety findings",
    "us_exclusivity": "US exclusivity and patents",
    "medicare": "Medicare coverage",
    "us_list_price": "US list price",
    "latest_annual_sales": "Annual sales",
    "competitors": "Competitors",
    "differentiation": "Differentiation",
    "risks": "Risks",
    "upcoming_catalysts": "Upcoming catalysts",
}
CONFIDENCE_ORDER = ["low", "medium", "high"]
CHECK_GROUPS = [
    ("ClinicalTrials.gov", ("NCT ID", "trial ", "lead sponsor", "enrollment", "primary completion")),
    ("PubMed", ("PMID", "publication year", "journal", "result published")),
    ("Drugs@FDA and DailyMed", ("FDA application", "first approval date", "DailyMed", "label revision", "Indications and Usage")),
    ("Effect sizes", ("estimate inside", "P value")),
    ("Dates", ("approval date is not", "indication approved on", "accelerated approval")),
    ("Agreement between sections", ("brand region", "news approval", "news rejection")),
]
SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥", "CNY": "CN¥", "RMB": "CN¥", "CHF": "CHF ", "KRW": "₩"}
RATIOS = {"hazard ratio", "odds ratio", "risk ratio", "rate ratio"}
SHORT_MEASURE = {"hazard ratio": "HR", "odds ratio": "OR", "risk ratio": "RR", "rate ratio": "RR", "difference in means": "Δ", "difference in proportions": "Δ"}


# ----------------------------------------------------------------------------- setup


def ensure_pdf_support() -> None:
    """Import WeasyPrint, pointing macOS at Homebrew's Pango if needed."""
    try:
        import weasyprint  # noqa: F401
    except OSError:
        homebrew = next((d for d in ("/opt/homebrew/lib", "/usr/local/lib") if Path(d, "libpango-1.0.0.dylib").exists()), None)
        if sys.platform == "darwin" and homebrew and "DYLD_FALLBACK_LIBRARY_PATH" not in os.environ:
            # dyld reads this variable only at process start, so restart with it set.
            os.execve(sys.executable, [sys.executable, *sys.orig_argv[1:]], {**os.environ, "DYLD_FALLBACK_LIBRARY_PATH": homebrew})
        sys.exit(
            "PDF rendering needs the Pango library.\n"
            "  macOS:          brew install pango\n"
            "  Debian/Ubuntu:  sudo apt install libpango-1.0-0 libpangoft2-1.0-0"
        )


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# ----------------------------------------------------------------------------- format


def sentence(text: str) -> str:
    return text[:1].upper() + text[1:]


def long_date(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%B %-d, %Y")


def month(text: str | None) -> str:
    """'2023-01-06' -> 'Jan 2023'; '2027-Q1' and other strings pass through."""
    parsed = checks.parse_date(text)
    if not parsed:
        return text or ""
    d, precision = parsed
    return str(d.year) if precision == 1 else d.strftime("%b %Y")


def domain(url: str) -> str:
    return url.split("://", 1)[-1].split("/", 1)[0].removeprefix("www.")


def num(v, digits: int = 0) -> str:
    return "n/a" if not isinstance(v, (int, float)) else f"{MINUS if v < 0 else ''}{abs(v):,.{digits}f}"


def money(v, cur: str | None = "USD") -> str:
    """Millions in, '$1.2B' / '¥88.0B' out."""
    if not isinstance(v, (int, float)):  # None, or a field missing from a failed run
        return "n/a"
    sym = SYMBOLS.get((cur or "USD").upper(), f"{(cur or '').upper()} ")
    return f"{sym}{v / 1000:,.1f}B" if abs(v) >= 1000 else f"{sym}{v:,.0f}M"


def stat(v) -> str:
    """An effect size as printed: two decimals for ratios and small differences, fewer for big ones."""
    if not isinstance(v, (int, float)):
        return "n/a"
    digits = 2 if abs(v) < 10 else 1
    return f"{v:.{digits}f}".replace("-", MINUS)


def first_sentences(text: str | None, limit: int = 150) -> str:
    """Trim to whole sentences under the limit so variable-length text can't push a section onto the next page."""
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("; "))
    return cut[: end + 1] if end > limit * 0.5 else cut.rsplit(" ", 1)[0] + "…"


# ----------------------------------------------------------------------------- merge


def merge(data: dict) -> tuple[dict, dict, list[str]]:
    """Every run's content under its section name; basis flattened by field (field names are unique across sections)."""
    content, basis, failed = {}, {}, []
    for section in (*spec.SECTIONS, "outlook"):
        run = (data.get("runs") or {}).get(section) or {}
        content[section] = run.get("content") or {}
        if not run.get("content"):
            failed.append(section)
            continue
        label = f"{section} run · {run['processor']}"
        basis.update({b["field"]: {**b, "run": label} for b in run.get("basis", [])})
    return content, basis, failed


# ----------------------------------------------------------------------------- derive


def check_index(results: list[dict]) -> dict[str, str]:
    """Worst result per identifier: 'fail' beats 'pass'; skips do not count."""
    worst: dict[str, str] = {}
    for r in results:
        if r.get("ref") and r["result"] != "skip":
            worst[r["ref"]] = "fail" if "fail" in (worst.get(r["ref"]), r["result"]) else "pass"
    return worst


def check_groups(results: list[dict]) -> list[dict]:
    groups = []
    for name, prefixes in CHECK_GROUPS:
        rs = [r for r in results if r["result"] != "skip" and r["check"].startswith(prefixes)]
        if rs:
            groups.append({"name": name, "passed": sum(r["result"] == "pass" for r in rs), "total": len(rs),
                           "failures": [r for r in rs if r["result"] == "fail"]})
    return groups


def forest(r: dict, width: int = 150, height: int = 18) -> Markup:
    """One row of a forest plot: the 95% CI as a line, the estimate as a dot, the null as a dashed rule.

    Ratios use a log scale centred on 1, differences a linear scale centred on 0.
    """
    est, lo, hi = r.get("estimate"), r.get("ci_lower"), r.get("ci_upper")
    if None in (est, lo, hi) or (r.get("effect_measure") in RATIOS and min(est, lo, hi) <= 0):
        return Markup("")
    ratio = r.get("effect_measure") in RATIOS
    f = math.log if ratio else (lambda v: v)
    null = f(1.0) if ratio else 0.0
    lo, hi = sorted((lo, hi))
    reach = max(abs(f(lo) - null), abs(f(hi) - null), 1e-9) * 1.15
    pad = 6

    def x(v):
        return pad + (width - 2 * pad) * (f(v) - (null - reach)) / (2 * reach)

    nx = pad + (width - 2 * pad) / 2
    return Markup(
        f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">'
        f'<line x1="{nx:.1f}" x2="{nx:.1f}" y1="1" y2="{height - 1}" stroke="{INK2}" stroke-width="0.75" stroke-dasharray="2 2"/>'
        f'<line x1="{x(lo):.1f}" x2="{x(hi):.1f}" y1="{height / 2}" y2="{height / 2}" stroke="{INK}" stroke-width="1.2"/>'
        f'<line x1="{x(lo):.1f}" x2="{x(lo):.1f}" y1="{height / 2 - 3}" y2="{height / 2 + 3}" stroke="{INK}" stroke-width="1.2"/>'
        f'<line x1="{x(hi):.1f}" x2="{x(hi):.1f}" y1="{height / 2 - 3}" y2="{height / 2 + 3}" stroke="{INK}" stroke-width="1.2"/>'
        f'<circle cx="{x(est):.1f}" cy="{height / 2}" r="3.4" fill="{ORANGE}" stroke="{CARD}" stroke-width="1.4"/></svg>'
    )


def when(text: str | None) -> tuple[int, int, int]:
    """Sort key for '2026-12-03', '2026-12', '2027-Q1' or '2027-H1'; unparseable dates sort last."""
    text = (text or "").strip()
    if m := re.fullmatch(r"(\d{4})-?Q([1-4])", text):
        return int(m.group(1)), 3 * int(m.group(2)) - 2, 1
    if m := re.fullmatch(r"(\d{4})-?H([12])", text):
        return int(m.group(1)), 6 * int(m.group(2)) - 5, 1
    parsed = checks.parse_date(text)
    return (parsed[0].year, parsed[0].month, parsed[0].day) if parsed else (9999, 12, 31)


def significant(r: dict) -> bool | None:
    lo, hi = r.get("ci_lower"), r.get("ci_upper")
    if lo is None or hi is None or r.get("effect_measure") == "other":
        return None
    null = 1.0 if r.get("effect_measure") in RATIOS else 0.0
    lo, hi = sorted((lo, hi))
    return not (lo <= null <= hi)


def claims(c: dict, regions: list[dict], comp: dict, unconfirmed: list[dict]) -> dict:
    """Section headlines written from the facts, so each title states a finding."""
    approved = [r["short"] for r in regions if r["status"] == "approved"]
    firsts = [checks.parse_date(r["first"]) for r in regions if r["status"] == "approved" and r["first"]]
    if approved:
        reg = f"Approved in {', '.join(approved[:-1]) + ' and ' + approved[-1] if len(approved) > 1 else approved[0]}"
        if firsts:
            reg += f", first in {min(firsts)[0].strftime('%b %Y')}"
    else:
        reg = "Not yet approved in the US, EU, China or Japan"
    us = next(r for r in regions if r["key"] == "us")
    if us["status"] not in ("approved", "not filed", "unknown"):
        reg += f"; US: {us['status']}"

    pivotal = c["trials"].get("pivotal_trials", [])
    n = sum(t.get("enrollment") or 0 for t in pivotal)
    phases = {t.get("phase") for t in pivotal}
    trials = f"{len(pivotal)} pivotal trial{'s' * (len(pivotal) != 1)}" + (f" ({', '.join(sorted(p for p in phases if p))})" if phases - {None} else "")
    trials += f" enrolling {n:,.0f} patients" if n else ""

    results = c["evidence"].get("pivotal_results", [])
    sig = [significant(r) for r in results]
    known = [s for s in sig if s is not None]
    if known:
        evidence = f"Statistically significant primary result in {sum(known)} of {len(known)} pivotal publication{'s' * (len(known) != 1)}"
    elif results:
        evidence = f"{len(results)} pivotal result{'s' * (len(results) != 1)}; confidence intervals not reported"
    else:
        evidence = "No peer-reviewed pivotal results found"

    if comp.get("last_protection_ends"):
        market = f"Listed US protection runs to {month(comp['last_protection_ends'])}"
    elif us["status"] == "approved":
        market = "No US patents or exclusivities found"
    else:
        market = "No US market protection: not approved in the US"
    return {"regulatory": reg, "trials": trials, "evidence": evidence, "market": market}


class Sources:
    """Numbers each cited URL in order of first use, and summarizes basis per section."""

    def __init__(self, basis: dict):
        self.basis = basis
        self.urls: list[str] = []
        self.titles: dict[str, str] = {}
        for b in basis.values():
            for cit in b.get("citations") or []:
                title = " ".join((cit.get("title") or "").split())
                if len(title) > 12 and not re.fullmatch(r"[\w.-]+", title):
                    self.titles.setdefault(cit["url"], title)

    def refs(self, field: str) -> list[int]:
        b = self.basis.get(field)
        if not b:
            return []
        for cit in (b.get("citations") or [])[:2]:
            if cit["url"] not in self.urls:
                self.urls.append(cit["url"])
        return sorted({self.urls.index(cit["url"]) + 1 for cit in (b.get("citations") or [])[:2]})

    def line(self, *fields: str) -> str:
        """'Medium confidence · fda.gov, ema.europa.eu' for a section's fields."""
        entries = [self.basis[f] for f in fields if f in self.basis]
        levels = [b["confidence"] for b in entries if b.get("confidence") in CONFIDENCE_ORDER]
        domains = list(dict.fromkeys(domain(c["url"]) for b in entries for c in (b.get("citations") or [])[:3]))
        parts = [f"{min(levels, key=CONFIDENCE_ORDER.index).capitalize()} confidence"] if levels else []
        if domains:
            parts.append(", ".join(domains[:3]) + (f" +{len(domains) - 3}" if len(domains) > 3 else ""))
        return " · ".join(parts)

    def rows(self) -> list[dict]:
        out = []
        for field, label in FIELD_LABELS.items():
            b = self.basis.get(field)
            if b is None:
                continue
            out.append({"label": label, "confidence": b.get("confidence") or "n/a", "reasoning": first_sentences(b.get("reasoning"), 230),
                        "refs": self.refs(field), "run": b.get("run", "")})
        return out

    def listing(self) -> list[dict]:
        return [{"n": i + 1, "url": u, "domain": domain(u), "title": self.titles.get(u) or u.split("://", 1)[-1].split("/", 1)[-1]}
                for i, u in enumerate(self.urls)]

    def domain_counts(self) -> list[tuple[str, int]]:
        counts: dict[str, int] = {}
        for u in self.urls:
            counts[domain(u)] = counts.get(domain(u), 0) + 1
        return sorted(counts.items(), key=lambda kv: -kv[1])


# ----------------------------------------------------------------------------- build


def build(data: dict, out: Path | None = None) -> dict:
    asset = data["asset"]
    c, basis, failed = merge(data)
    idn, reg, news = c["identity"], c["regulatory"], c["news"]
    chk = data.get("checks") or checks.run_all(data)
    comp = chk.get("computed", {})
    unconfirmed = checks.unconfirmed_approvals(reg, news)

    regions = []
    for key, name in REGIONS:
        r = reg.get(key) or {}
        ident = {"us": r.get("application_number"), "eu": r.get("ema_product_number"), "china": r.get("nmpa_approval_number")}.get(key) or ""
        regions.append({"key": key, "name": name, "short": REGION_SHORT[key], "status": r.get("status") or "unknown",
                        "first": r.get("first_approval_date") or "", "id": ident, "indications": r.get("approved_indications") or []})
    indications = [{"region": r["short"], **i} for r in regions for i in r["indications"]]
    indications += [{"region": REGION_SHORT.get(a["region"], a["region"]), "indication": a["detail"], "approval_date": a["date"], "unconfirmed": True}
                    for a in unconfirmed]
    indications.sort(key=lambda i: (checks.parse_date(i.get("approval_date")) or (date.min, 0))[0])

    generic = (idn.get("generic_name") or "").strip()
    brand = next((b["name"] for b in idn.get("brand_names", []) if b.get("region") == "United States"), None)
    if brand and generic and generic.lower() != brand.lower() and not generic.lower().startswith("none"):
        title = f"{brand} ({generic})"
    else:
        title = generic if generic and not generic.lower().startswith("none") else asset["asset"]

    catalysts = [{"date": e.get("expected_date", ""), "text": e.get("event", ""), "field": f"upcoming_catalysts.{i}"}
                 for i, e in enumerate(c["outlook"].get("upcoming_catalysts", []))]
    if not catalysts:  # no outlook: fall back to the decisions the news run found
        catalysts = [{"date": e.get("expected_date", ""), "text": e.get("decision", ""), "region": e.get("region"), "decision": True,
                      "field": f"pending_decisions.{i}"} for i, e in enumerate(news.get("pending_decisions", []))]
    catalysts.sort(key=lambda e: when(e["date"]))

    calls: dict[str, int] = {}
    for run in (data.get("runs") or {}).values():
        for call in (run or {}).get("connector_calls") or []:
            calls[call["connector"]] = calls.get(call["connector"], 0) + 1

    image = data.get("image") or {}
    if image.get("status") == "found" and out is not None and (out / image["file"]).exists():
        image = {**image, "uri": (out / image["file"]).resolve().as_uri(), "domain": domain(image["source_page_url"])}
    else:
        image = {}

    levels = [b.get("confidence") for f, b in basis.items() if f in FIELD_LABELS]
    results = c["evidence"].get("pivotal_results", [])
    return {
        "asset": asset,
        "title": title,
        "c": c,
        "regions": regions,
        "indications": indications,
        "catalysts": catalysts,
        "image": image,
        "unconfirmed": unconfirmed,
        "label": data.get("label") or {},
        "checks": chk,
        "check_by_ref": check_index(chk.get("results", [])),
        "check_groups": check_groups(chk.get("results", [])),
        "computed": comp,
        "claims": claims(c, regions, comp, unconfirmed),
        "results": [{**r, "plot": forest(r), "significant": significant(r), "short": SHORT_MEASURE.get(r.get("effect_measure"), "")} for r in results],
        "connector_calls": sorted(calls.items(), key=lambda kv: -kv[1]),
        "failed": failed,
        "src": Sources(basis),
        "conf_counts": {k: levels.count(k) for k in CONFIDENCE_ORDER},
        "generated": date.today().isoformat(),
    }


def font_css() -> str:
    font_dir = os.environ.get("PROFILE_FONT_DIR")
    if not font_dir:
        return WEB_FONTS
    d = Path(font_dir).expanduser()
    faces = []
    for fam, weight, stem in BRAND_FONTS:
        f = next((d / f"{stem}{ext}" for ext in (".ttf", ".otf") if (d / f"{stem}{ext}").exists()), None)
        if f:
            faces.append(f"@font-face {{ font-family: '{fam}'; font-weight: {weight}; src: url('{f.as_uri()}'); }}")
    return "\n".join([WEB_FONTS, *faces])


def render_all(out: Path, assets: list[dict]) -> tuple[list[Path], list[str]]:
    from weasyprint import HTML

    # A failed run leaves its section empty; ChainableUndefined renders missing fields as blank instead of raising.
    env = Environment(loader=FileSystemLoader(ROOT / "templates"), autoescape=True, undefined=ChainableUndefined)
    env.filters.update(long_date=long_date, month=month, domain=domain, clip=first_sentences, num=num, money=money, stat=stat, sentence=sentence)
    template = env.get_template("profile.html.j2")
    shared = {
        "font_css": Markup(font_css()),
        "wordmark": Markup((ROOT / "assets" / "parallel-wordmark.svg").read_text()),
        "lockup": Markup((ROOT / "assets" / "parallel-lockup.svg").read_text()),
    }
    (out / "pdf").mkdir(parents=True, exist_ok=True)
    profiles, written, incomplete = [], [], []
    for asset in assets:
        path = out / "data" / f"{slug(asset['asset'])}.json"
        if not path.exists():
            print(f"  {asset['asset']}: no research saved, skipped")
            incomplete.append(asset["asset"])
            continue
        try:
            profile = build(json.loads(path.read_text()), out)
            pdf = out / "pdf" / f"{slug(asset['asset'])}.pdf"
            HTML(string=template.render(profiles=[profile], **shared), base_url=str(ROOT)).write_pdf(pdf)
        except Exception as e:  # one malformed result should not stop the batch
            print(f"  {asset['asset']}: render failed: {e!r}")
            incomplete.append(asset["asset"])
            continue
        if profile["failed"]:
            print(f"  {asset['asset']}: incomplete research: {', '.join(profile['failed'])}")
            incomplete.append(asset["asset"])
        profiles.append(profile)
        written.append(pdf)
    if profiles:
        HTML(string=template.render(profiles=profiles, **shared), base_url=str(ROOT)).write_pdf(out / "profiles.pdf")
    return written, incomplete
