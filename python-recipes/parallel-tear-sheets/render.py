"""Turn saved research into tear sheet PDFs. No API calls, no LLM.

Every derived number (growth, margins, free cash flow, net cash, P/E, upside),
every section headline and every data check is computed here from the
researched figures, so the same research always renders the same sheet.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from datetime import date
from itertools import pairwise
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from markupsafe import Markup

import spec

ROOT = Path(__file__).parent
MINUS = "−"
INK, INK2, RULE2, CARD, ORANGE = "#1D1B16", "#5C5B59", "#D4D2CA", "#F2F1EE", "#FB631B"
MONO = "'FT System Mono', 'Geist Mono', 'SF Mono', Menlo, monospace"

# Geist is open source and loads from Google Fonts at render time. Parallel's
# licensed brand fonts are used instead when TEARSHEET_FONT_DIR points at them.
WEB_FONTS = "@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono&display=swap');"
BRAND_FONTS = [
    ("Gerstner Programm", 400, "Gerstner-ProgrammRegular.ttf"),
    ("Gerstner Programm", 500, "Gerstner-ProgrammMedium.ttf"),
    ("NaN Holo", 500, "NaNHoloStandard-Medium.ttf"),
    ("FT System Mono", 400, "FTSystemMono-Regular.ttf"),
]

SIGNALS = {
    "profitable_ttm": "Profitable, last 12 months",
    "beat_revenue_consensus": "Beat revenue consensus",
    "customer_over_10pct": "Customer at 10%+ of sales",
    "active_buyback": "Active share buyback",
    "ceo_or_cfo_change_12m": "CEO or CFO change, 12 mo",
    "material_legal_matter": "Material legal matter",
}
OUTLOOK = {"raised": "outlook raised", "maintained": "outlook maintained", "lowered": "outlook cut", "no_outlook": "no formal outlook"}
FIELD_LABELS = {
    "company_overview": "Company overview",
    "business_description": "Business description",
    "investment_summary": "Investment summary",
    "market_data": "Market data",
    "analyst_consensus": "Analyst consensus",
    "annual_financials": "Annual financials",
    "latest_period": "Latest period",
    "balance_sheet": "Balance sheet",
    "revenue_segments": "Revenue by segment",
    "bull_case": "Bull case",
    "bear_case": "Bear case",
    "key_risks": "Key risks",
    "recent_developments": "Recent developments",
    "upcoming_catalysts": "Upcoming catalysts",
    "leadership": "Leadership",
    "competitors": "Competitors",
    "balance_sheet_strength": "Balance sheet strength",
    "outlook_change": "Outlook change",
    **SIGNALS,
}
CONFIDENCE_ORDER = ["low", "medium", "high"]
SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥", "CNY": "CN¥", "RMB": "CN¥", "INR": "₹", "KRW": "₩",
           "CAD": "C$", "AUD": "A$", "HKD": "HK$", "TWD": "NT$", "BRL": "R$", "SGD": "S$"}


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


def slug(ticker: str) -> str:
    return re.sub(r"[^A-Za-z0-9.-]+", "-", ticker)


# ----------------------------------------------------------------------------- format


def money(v, cur: str | None = "USD", digits: int = 1) -> str:
    """Millions in, '$215.9B' / '€84.7B' / '¥48.04T' out."""
    if v is None:
        return "n/a"
    if v == 0:
        return f"{symbol(cur)}0"
    sign, v = (MINUS if v < 0 else ""), abs(v)
    if v >= 1_000_000:
        body = f"{v / 1_000_000:,.2f}T"
    elif v >= 1000:
        body = f"{v / 1000:,.{digits}f}B"
    else:
        body = f"{v:,.0f}M"
    return f"{sign}{symbol(cur)}{body}"


def price(v, cur: str | None = "USD", digits: int = 2) -> str:
    if v is None:
        return "n/a"
    if (cur or "").upper() in ("JPY", "KRW"):
        digits = 0  # quoted in whole units
    if (cur or "").upper() in ("GBX", "GBP_PENCE"):
        return f"{v:,.0f}p"
    return f"{MINUS if v < 0 else ''}{symbol(cur)}{abs(v):,.{digits}f}"


def symbol(cur: str | None) -> str:
    cur = (cur or "USD").upper()
    return SYMBOLS.get(cur, f"{cur} ")


def pct(v, signed: bool = False, digits: int = 1) -> str:
    if v is None:
        return "n/a"
    return (f"{v:+.{digits}%}" if signed else f"{v:.{digits}%}").replace("-", MINUS)


def num(v, digits: int = 0) -> str:
    return "n/a" if v is None else f"{MINUS if v < 0 else ''}{abs(v):,.{digits}f}"


def short_fy(label: str) -> str:
    m = re.search(r"(\d{4})(?:\D*$)", label or "") or re.search(r"(\d{2})\D*$", label or "")
    return f"FY{m.group(1)[-2:]}" if m else (label or "")


def sentence(text: str) -> str:
    return text[:1].upper() + text[1:]


def long_date(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%B %-d, %Y")


def domain(url: str) -> str:
    return url.split("://", 1)[-1].split("/", 1)[0].removeprefix("www.")


def first_sentences(text: str | None, limit: int = 150) -> str:
    """Trim to whole sentences under the limit so variable-length text can't push a section onto the next page."""
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("; "))
    return cut[: end + 1] if end > 80 else cut.rsplit(" ", 1)[0] + "…"


# ----------------------------------------------------------------------------- merge


EMPTY = {
    "company_overview": {}, "business_description": "", "leadership": [], "revenue_segments": [], "competitors": [],
    "reporting_currency": None, "annual_financials": [], "latest_period": {}, "balance_sheet": {},
    "market_data": {}, "analyst_consensus": {}, "recent_developments": [], "upcoming_catalysts": [],
    "investment_summary": "", "bull_case": [], "bear_case": [], "key_risks": [],
    "balance_sheet_strength": None, "outlook_change": None, **dict.fromkeys(SIGNALS),
}


def merge(data: dict) -> tuple[dict, dict, list[str]]:
    """Combine a company's runs into one content dict; each basis entry remembers its run."""
    content, basis, failed = dict(EMPTY), {}, []
    for section in (*spec.SECTIONS, "thesis"):
        run = (data.get("runs") or {}).get(section, {})
        if not run.get("content"):
            failed.append(section)
            continue
        content.update({k: v for k, v in run["content"].items() if v is not None})
        label = f"{section} run · {run['processor']}"
        basis.update({b["field"]: {**b, "run": label} for b in run["basis"]})
    return content, basis, failed


# ----------------------------------------------------------------------------- derive


def ratio(a, b):
    return a / b if a is not None and b not in (None, 0) else None


def derive(c: dict) -> dict:
    """Computed metrics, KPI tiles and cross-checks. Nothing here is researched."""
    cur = c["reporting_currency"]
    years = [y for y in c["annual_financials"] if isinstance(y, dict)]
    for prev, y in pairwise([None, *years]):
        growth = ratio(y.get("revenue_m"), prev and prev.get("revenue_m"))
        y["revenue_yoy"] = growth - 1 if growth is not None and prev["revenue_m"] > 0 else None
        y["op_margin"] = ratio(y.get("operating_income_m"), y.get("revenue_m"))
        y["net_margin"] = ratio(y.get("net_income_m"), y.get("revenue_m"))
        ocf, capex = y.get("operating_cash_flow_m"), y.get("capex_m")
        y["fcf_m"] = ocf - abs(capex) if ocf is not None and capex is not None else None

    m, bs, ac = c["market_data"], c["balance_sheet"], c["analyst_consensus"]
    last = years[-1] if years else {}
    pcur = m.get("price_currency")
    px, lo, hi = m.get("price"), m.get("low_52w"), m.get("high_52w")
    financial = (c["company_overview"].get("sector") or "").lower() in ("financials", "financial services")

    eps = last.get("diluted_eps")
    if px and eps and eps > 0 and pcur and cur and pcur.upper() == cur.upper():
        pe, pe_basis, pe_note = px / eps, short_fy(last.get("fiscal_year")), f"{short_fy(last.get('fiscal_year'))} diluted EPS"
    else:
        pe, pe_basis, pe_note = m.get("trailing_pe"), "trailing", "trailing, as quoted"
    cash, debt = bs.get("cash_and_investments_m"), bs.get("total_debt_m")
    target = ac.get("mean_price_target")

    kpis = [
        {"label": "Market cap", "value": money(m.get("market_cap_usd_b") and m["market_cap_usd_b"] * 1000, "USD"),
         "sub": f"{num(bs.get('shares_outstanding_m'))}M shares" if bs.get("shares_outstanding_m") else "USD"},
        {"label": "P/E", "value": f"{pe:.1f}×" if pe else "n/a", "sub": pe_note if pe else "no positive earnings"},
    ]
    if not financial:
        kpis.append({"label": "Net cash", "value": money(cash - debt if cash is not None and debt is not None else None, cur),
                     "sub": bs.get("as_of") or ""})
    kpis.append({"label": "Dividend yield", "value": "n/a" if m.get("dividend_yield_pct") is None else f"{m['dividend_yield_pct']:.2f}%", "sub": "forward"})
    kpis.append({"label": "Consensus target", "value": price(target, pcur, 0) if target else "n/a",
                 "sub": " · ".join(x for x in [ac.get("rating"), f"{num(ac.get('analyst_count'))} analysts" if ac.get("analyst_count") else ""] if x and x != "Not available"),
                 "delta": pct(ratio(target, px) - 1, signed=True, digits=0) if target and px else ""})

    checks = []
    if px and bs.get("shares_outstanding_m") and m.get("market_cap_usd_b") and (pcur or "").upper() == (cur or "").upper() == "USD":
        gap = px * bs["shares_outstanding_m"] / 1000 / m["market_cap_usd_b"] - 1
        checks.append(("Market cap matches price × shares", pct(gap, signed=True), abs(gap) < 0.1))
    implied = [y["net_income_m"] / y["diluted_eps"] for y in years
               if y.get("net_income_m") and y.get("diluted_eps") and (y["net_income_m"] > 0) == (y["diluted_eps"] > 0)]
    if len(implied) >= 2:
        spread = max(implied) / min(implied)
        # A jump means a stock split, an IPO or a large issuance: worth checking the EPS basis.
        checks.append(("Share count implied by EPS is stable", f"varies {spread:.1f}× across years", spread < 1.6))
    repeats = [y["fiscal_year"] for prev, y in pairwise(years) if y.get("revenue_m") and y["revenue_m"] == prev.get("revenue_m")]
    if len(years) >= 2:
        checks.append(("Each fiscal year reports different revenue", ", ".join(repeats) or "all distinct", not repeats))
    lp = c["latest_period"]
    if lp.get("period_end") and bs.get("as_of"):
        try:  # semiannual reporters publish a balance sheet every six months, not every quarter
            lag = (date.fromisoformat(lp["period_end"]) - date.fromisoformat(bs["as_of"])).days
            checks.append(("Balance sheet is within six months of the latest period", bs["as_of"], 0 <= lag <= 183))
        except ValueError:
            pass
    if years and lp.get("period_end") and last.get("period_end"):
        checks.append(("Latest period is after the last fiscal year", lp["period_end"], lp["period_end"] > last["period_end"]))
    if m.get("price_date"):
        try:
            age = (date.today() - date.fromisoformat(m["price_date"])).days
            checks.append(("Price is less than a week old", f"{age} day{'s' * (age != 1)}", 0 <= age <= 7))
        except ValueError:
            pass

    return {
        "cur": cur, "pcur": pcur, "years": years, "last": last, "prev": years[-2] if len(years) > 1 else {},
        "kpis": kpis, "checks": checks, "financial": financial,
        "pe_phrase": f"{pe:.1f}× {pe_basis} earnings" if pe else None,
        "range_pos": ratio((px or 0) - (lo or 0), (hi or 0) - (lo or 0)) if px and lo and hi and hi > lo else None,
        "has_op_income": any(y.get("operating_income_m") is not None for y in years),
    }


def claims(c: dict, d: dict) -> dict:
    """Section headlines written from the numbers, so each title states a finding."""
    last, cur = d["last"], d["cur"]
    fy = last.get("fiscal_year", "")
    if last.get("revenue_yoy") is not None:
        if abs(last["revenue_yoy"]) < 0.0005:
            fin = f"{fy} revenue flat at {money(last['revenue_m'], cur)}"
        else:
            verb = "rose" if last["revenue_yoy"] > 0 else "fell"
            fin = f"{fy} revenue {verb} {pct(abs(last['revenue_yoy']))} to {money(last['revenue_m'], cur)}"
        if last.get("op_margin") is not None:
            fin += f", {pct(last['op_margin'])} operating margin"
        elif last.get("net_margin") is not None:
            fin += f", {pct(last['net_margin'])} net margin"
    elif last.get("net_income_m") is not None:
        word = "net income" if last["net_income_m"] >= 0 else "net loss"
        fin = f"{fy} {word} of {money(abs(last['net_income_m']), cur)}"
    else:
        fin = "Reported financials"

    parts = [d["pe_phrase"]] if d["pe_phrase"] else []
    if d["range_pos"] is not None:
        parts.append(f"{d['range_pos']:.0%} up its 52-week range")
    market = sentence(", ".join(parts)) or "Market data"

    bits = [f"Balance sheet reads {c['balance_sheet_strength']}"] if c["balance_sheet_strength"] else []
    if outlook := OUTLOOK.get(c["outlook_change"]):
        bits.append(f"{outlook} at the last report")
    sig = sentence("; ".join(bits)) or "Signals"
    return {"financials": fin, "market": market, "signals": sig}


# ----------------------------------------------------------------------------- citations


class Sources:
    """Numbers each cited URL in order of first use, and summarizes basis per section."""

    def __init__(self, basis: dict):
        self.basis = basis
        self.urls: list[str] = []
        self.titles: dict[str, str] = {}
        for b in basis.values():
            for cit in b["citations"]:
                title = " ".join((cit.get("title") or "").split())
                if len(title) > 12 and not re.fullmatch(r"[\w.-]+", title):
                    self.titles.setdefault(cit["url"], title)

    def refs(self, field: str) -> list[int]:
        b = self.basis.get(field)
        if not b:
            return []
        for cit in b["citations"][:2]:
            if cit["url"] not in self.urls:
                self.urls.append(cit["url"])
        return sorted({self.urls.index(cit["url"]) + 1 for cit in b["citations"][:2]})

    def line(self, *fields: str) -> str:
        """'Medium confidence · sec.gov, investor.nvidia.com' for a section's fields."""
        entries = [self.basis[f] for f in fields if f in self.basis]
        levels = [b["confidence"] for b in entries if b.get("confidence") in CONFIDENCE_ORDER]
        domains = list(dict.fromkeys(domain(c["url"]) for b in entries for c in b["citations"][:2]))
        parts = [f"{min(levels, key=CONFIDENCE_ORDER.index).capitalize()} confidence"] if levels else []
        if domains:
            parts.append(", ".join(domains[:3]) + (f" +{len(domains) - 3}" if len(domains) > 3 else ""))
        return " · ".join(parts)

    def rows(self, content: dict) -> list[dict]:
        out = []
        for field, label in FIELD_LABELS.items():
            b = self.basis.get(field)
            if b is None or not content.get(field):
                continue
            out.append({"label": label, "confidence": b.get("confidence") or "n/a", "reasoning": first_sentences(b.get("reasoning")),
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


# ----------------------------------------------------------------------------- charts


def nice_step(span: float, target: int = 3) -> float:
    raw = span / target
    mag = 10 ** math.floor(math.log10(raw))
    return next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw)


def column_chart(values: list[tuple[str, float | None]], cur: str | None, width=336, height=72) -> Markup:
    """Columns from a zero baseline; earlier years in Index black, the latest in orange.

    WeasyPrint ignores page CSS inside inline SVG, so all styling is attributes.
    """
    pts = [(lbl, v) for lbl, v in values if v is not None]
    if not pts:
        return Markup('<div class="t-note" style="margin-top:8px">Not reported.</div>')
    left, right, top, bottom = 40, 8, 12, 16
    hi, lo = max(0, *(v for _, v in pts)), min(0, *(v for _, v in pts))
    step = nice_step((hi - lo) or 1)
    hi, lo = math.ceil(hi / step) * step, math.floor(lo / step) * step
    plot_w, plot_h = width - left - right, height - top - bottom

    def y(v):
        return top + plot_h * (hi - v) / ((hi - lo) or 1)

    t = f'font-family="{MONO}" font-size="6.5"'
    out = [f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">']
    tick = lo
    while tick <= hi + step / 2:
        out.append(f'<line x1="{left}" x2="{width - right}" y1="{y(tick):.1f}" y2="{y(tick):.1f}" stroke="{RULE2}" stroke-width="0.75"/>')
        out.append(f'<text x="{left - 4}" y="{y(tick) + 2.3:.1f}" {t} fill="{INK2}" text-anchor="end">{money(tick, cur, 0)}</text>')
        tick += step
    band = plot_w / len(pts)
    bar = min(24, band * 0.42)
    for i, (lbl, v) in enumerate(pts):
        x = left + band * i + (band - bar) / 2
        y0, y1 = y(0), y(v)
        top_y, h = min(y0, y1), max(abs(y1 - y0), 0.75)
        out.append(f'<rect x="{x:.1f}" y="{top_y:.1f}" width="{bar:.1f}" height="{h:.1f}" fill="{ORANGE if i == len(pts) - 1 else INK}"/>')
        ly = top_y - 4 if v >= 0 else top_y + h + 8
        out.append(f'<text x="{x + bar / 2:.1f}" y="{ly:.1f}" {t} fill="{INK}" text-anchor="middle" paint-order="stroke" stroke="{CARD}" stroke-width="2.2">{money(v, cur)}</text>')
        out.append(f'<text x="{x + bar / 2:.1f}" y="{height - 4}" {t} fill="{INK2}" text-anchor="middle">{lbl}</text>')
    out.append("</svg>")
    return Markup("".join(out))


def range_bar(pos: float | None, width=200) -> Markup:
    if pos is None:
        return Markup("")
    x = 4 + (width - 8) * pos
    return Markup(
        f'<svg width="{width}" height="12" viewBox="0 0 {width} 12" xmlns="http://www.w3.org/2000/svg">'
        f'<line x1="4" x2="{width - 4}" y1="6" y2="6" stroke="{RULE2}" stroke-width="1"/>'
        f'<line x1="4" x2="4" y1="1" y2="11" stroke="{INK}" stroke-width="1.2"/>'
        f'<line x1="{width - 4}" x2="{width - 4}" y1="1" y2="11" stroke="{INK}" stroke-width="1.2"/>'
        f'<circle cx="{x:.1f}" cy="6" r="3.8" fill="{ORANGE}" stroke="{CARD}" stroke-width="1.6"/></svg>'
    )


# ----------------------------------------------------------------------------- build


def build(data: dict) -> dict:
    company = data["company"]
    content, basis, failed = merge(data)
    d = derive(content)
    levels = [basis[f].get("confidence") for f in FIELD_LABELS if f in basis and content.get(f)]
    segs = [s for s in content["revenue_segments"] if isinstance(s, dict) and s.get("revenue_m")]
    seg_total = sum(s["revenue_m"] for s in segs) or None
    cur = d["cur"]
    return {
        "ticker": company["ticker"],
        "name": legal if (legal := content["company_overview"].get("legal_name")) and len(legal) <= 36 else company["company_name"],
        "c": content,
        "d": d,
        "failed": failed,
        "claims": claims(content, d),
        "src": Sources(basis),
        "charts": {
            "revenue": column_chart([(short_fy(y.get("fiscal_year")), y.get("revenue_m")) for y in d["years"]], cur),
            "net_income": column_chart([(short_fy(y.get("fiscal_year")), y.get("net_income_m")) for y in d["years"]], cur),
        },
        "range_bar": range_bar(d["range_pos"]),
        "signals": [{"field": k, "label": v, "answer": content[k]} for k, v in SIGNALS.items() if content[k]],
        "segments": [{**s, "share": s["revenue_m"] / seg_total} for s in segs] if len(segs) > 1 else [],
        "conf_counts": {k: levels.count(k) for k in CONFIDENCE_ORDER},
        "generated": date.today().isoformat(),
    }


def font_css() -> str:
    font_dir = os.environ.get("TEARSHEET_FONT_DIR")
    if not font_dir:
        return WEB_FONTS
    d = Path(font_dir).expanduser()
    faces = [f"@font-face {{ font-family: '{fam}'; font-weight: {w}; src: url('{(d / f).as_uri()}'); }}"
             for fam, w, f in BRAND_FONTS if (d / f).exists()]
    return "\n".join([WEB_FONTS, *faces])


def render_all(out: Path, companies: list[dict]) -> tuple[list[Path], list[str]]:
    from weasyprint import HTML

    env = Environment(loader=FileSystemLoader(ROOT / "templates"), autoescape=True)
    env.filters.update(money=money, price=price, pct=pct, num=num, short_fy=short_fy, long_date=long_date, domain=domain,
                       clip=first_sentences)
    template = env.get_template("tearsheet.html.j2")
    shared = {
        "font_css": Markup(font_css()),
        "wordmark": Markup((ROOT / "assets" / "parallel-wordmark.svg").read_text()),
        "lockup": Markup((ROOT / "assets" / "parallel-lockup.svg").read_text()),
    }
    (out / "pdf").mkdir(parents=True, exist_ok=True)
    sheets, written, incomplete = [], [], []
    for company in companies:
        path = out / "data" / f"{slug(company['ticker'])}.json"
        if not path.exists():
            print(f"  {company['ticker']}: no research saved, skipped")
            incomplete.append(company["ticker"])
            continue
        try:
            sheet = build(json.loads(path.read_text()))
            pdf = out / "pdf" / f"{slug(company['ticker'])}.pdf"
            HTML(string=template.render(sheets=[sheet], **shared), base_url=str(ROOT)).write_pdf(pdf)
        except Exception as e:  # one malformed result should not stop the batch
            print(f"  {company['ticker']}: render failed: {e!r}")
            incomplete.append(company["ticker"])
            continue
        if sheet["failed"]:
            print(f"  {company['ticker']}: incomplete research: {', '.join(sheet['failed'])}")
            incomplete.append(company["ticker"])
        sheets.append(sheet)
        written.append(pdf)
    if sheets:
        HTML(string=template.render(sheets=sheets, **shared), base_url=str(ROOT)).write_pdf(out / "tearsheets.pdf")
    return written, incomplete
