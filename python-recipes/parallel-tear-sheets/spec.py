"""What to research: the Task API output schemas for each section of the tear sheet.

Every field follows the same pattern: the entity, what to find, the unit or
format, and what to return when the fact is not available. Money fields are in
millions of the currency named alongside them, so a company that reports in EUR
or JPY is never converted with an unknown FX rate.
"""

from __future__ import annotations


def s(desc: str) -> dict:
    return {"type": "string", "description": desc}


def n(desc: str) -> dict:
    return {"anyOf": [{"type": "number"}, {"type": "null"}], "description": desc + " Null if not available."}


def obj(desc: str, **props: dict) -> dict:
    return {"type": "object", "description": desc, "properties": props, "required": list(props), "additionalProperties": False}


def arr(desc: str, item: dict) -> dict:
    return {"type": "array", "description": desc, "items": item}


def task_spec(**fields: dict) -> dict:
    return {
        "input_schema": {"type": "json", "json_schema": COMPANY},
        "output_schema": {"type": "json", "json_schema": obj("Tear sheet section.", **fields)},
    }


COMPANY = obj(
    "A publicly listed company.",
    company_name=s("Company name"),
    ticker=s("Ticker symbol, with exchange suffix for non-US listings, e.g. MC.PA"),
    website=s("Company website, may be empty"),
)

REPORTED = "in millions of the reporting currency, as presented in the most recent annual report"

# ----------------------------------------------------------------------------- profile

PROFILE = task_spec(
    company_overview=obj(
        "Identity of the company.",
        legal_name=s("Full legal name."),
        exchange=s("Primary stock exchange, e.g. NASDAQ, NYSE, Euronext Paris, Tokyo Stock Exchange."),
        headquarters=s("Headquarters city, region, country."),
        founded_year=s("Year founded, YYYY."),
        employees=n("Total employees from the most recent annual report."),
        sector=s("GICS sector, e.g. Information Technology, Financials, Real Estate."),
        industry=s("GICS industry or closest equivalent, e.g. Semiconductors, Banks, Retail REITs."),
    ),
    business_description=s(
        "Three sentences for an investor: what the company sells, to whom, and how it makes money. "
        "Factual, no promotional language, no commentary about the data itself."
    ),
    leadership=arr(
        "The CEO, the CFO and up to two other executive officers, from the latest annual report or investor site.",
        obj("An executive.", name=s("Full name."), title=s("Current title.")),
    ),
    revenue_segments=arr(
        "Revenue by reportable segment for the most recent fiscal year, largest first. One entry if the company reports a single segment.",
        obj("A segment.", segment=s("Segment name as reported."), revenue_m=n(f"Segment revenue {REPORTED}.")),
    ),
    competitors=arr(
        "Four closest publicly listed competitors.",
        obj("A competitor.", company_name=s("Name."), ticker=s("Ticker, or 'Private'.")),
    ),
)

# ----------------------------------------------------------------------------- financials

FINANCIALS = task_spec(
    reporting_currency=s("ISO 4217 code of the currency the financial statements are presented in, e.g. USD, EUR, JPY."),
    annual_financials=arr(
        "Income statement and cash flow for the last four completed fiscal years, oldest first, from the annual "
        "report (10-K, 20-F or local equivalent). Return fewer only if the company has not reported four years yet.",
        obj(
            "One fiscal year.",
            fiscal_year=s("Fiscal year label as the company reports it, e.g. FY2025."),
            period_end=s("Fiscal year end date, YYYY-MM-DD."),
            revenue_m=n(f"Total revenue {REPORTED}. Banks: total net revenue. Insurers: total revenues. REITs: total revenues."),
            operating_income_m=n(f"Operating income {REPORTED}. Null if the company does not report it (common for banks and insurers)."),
            net_income_m=n(f"Net income attributable to shareholders {REPORTED}. Negative for a loss."),
            diluted_eps=n("Diluted EPS in the reporting currency (basic EPS if the company reports no diluted figure), adjusted for any later stock splits."),
            operating_cash_flow_m=n(f"Net cash from operating activities {REPORTED}."),
            capex_m=n(f"Capital expenditures {REPORTED}, as a positive number."),
        ),
    ),
    latest_period=obj(
        "The most recently reported interim period (quarter, or half-year for semiannual reporters).",
        label=s("Period label, e.g. Q3 FY2026 or H1 2026."),
        period_end=s("Period end date, YYYY-MM-DD."),
        reported_on=s("Date results were announced, YYYY-MM-DD."),
        revenue_m=n("Revenue for the period, in millions of the reporting currency."),
        revenue_yoy_pct=n("Revenue growth versus the same period a year earlier, percent."),
        net_income_m=n("Net income for the period, in millions of the reporting currency."),
        diluted_eps=n("Diluted EPS for the period in the reporting currency."),
        guidance=s("Management's current outlook in one sentence, or 'No guidance provided'."),
    ),
    balance_sheet=obj(
        "Balance sheet at the end of the latest reported period.",
        as_of=s("Balance sheet date, YYYY-MM-DD."),
        cash_and_investments_m=n("Cash, cash equivalents and current (short-term) investments in millions of the reporting currency. Exclude long-term investments."),
        total_debt_m=n("Total short- and long-term borrowings in millions of the reporting currency, excluding lease liabilities and, for banks, deposits."),
        shares_outstanding_m=n("Ordinary shares outstanding, millions, from the latest filing cover page or report."),
    ),
)

# ----------------------------------------------------------------------------- market

MARKET = task_spec(
    market_data=obj(
        "Trading data for the ticker given in the input. Use the most recent close you can find and report its date.",
        price=n("Share price at the most recent close, in the trading currency."),
        price_currency=s("ISO 4217 code of the trading currency, e.g. USD, EUR. Use GBX for pence."),
        price_date=s("Date of that close, YYYY-MM-DD."),
        market_cap_usd_b=n("Market capitalization at that date, in billions of US dollars."),
        high_52w=n("52-week high in the trading currency."),
        low_52w=n("52-week low in the trading currency."),
        dividend_yield_pct=n("Forward dividend yield, percent. 0 if the company pays no dividend."),
        trailing_pe=n("Trailing twelve-month P/E as shown on a major quote page. Null if earnings are negative."),
    ),
    analyst_consensus=obj(
        "Sell-side analyst consensus from a recent public summary.",
        rating=s("Consensus rating, e.g. Buy, Hold, Sell, or 'Not available'."),
        mean_price_target=n("Mean 12-month price target in the trading currency."),
        analyst_count=n("Number of analysts in the consensus."),
        as_of=s("Date of the consensus figures, YYYY-MM-DD."),
    ),
)

# ----------------------------------------------------------------------------- news

NEWS = task_spec(
    recent_developments=arr(
        "Up to five material company-specific developments in the last 90 days: results, guidance changes, M&A, major "
        "contracts, product launches, leadership changes, regulatory or legal actions. Newest first.",
        obj("A development.", date=s("Date, YYYY-MM-DD."), headline=s("Headline, under 10 words."), detail=s("One sentence on what happened and why it matters.")),
    ),
    upcoming_catalysts=arr(
        "Up to four scheduled or expected events in the next six months that could move the stock: next results date, "
        "investor day, product launch, regulatory decision, debt maturity.",
        obj("A catalyst.", expected_date=s("Date or month, YYYY-MM-DD or YYYY-MM."), event=s("The event, one sentence.")),
    ),
)

# ----------------------------------------------------------------------------- thesis (second stage)

THESIS = {
    "input_schema": {
        "type": "json",
        "json_schema": obj(
            "A company and facts already researched about it.",
            company_name=s("Company name"),
            ticker=s("Ticker"),
            facts=s("JSON of researched facts: profile, financials, market data and recent news."),
        ),
    },
    "output_schema": {
        "type": "json",
        "json_schema": obj(
            "Investment thesis.",
            investment_summary=s(
                "Three sentences an analyst would put at the top of a tear sheet: the company's position, what is "
                "driving results now, and the main debate on the stock. Grounded in reported facts."
            ),
            bull_case=arr("Three concise bull-case points, each grounded in a specific fact or number.", s("A point.")),
            bear_case=arr("Three concise bear-case points, each grounded in a specific fact or number.", s("A point.")),
            key_risks=arr("Four key risks from the annual report risk factors and recent news, one sentence each.", s("A risk.")),
        ),
    },
}

# ----------------------------------------------------------------------------- signals


def check(desc: str) -> dict:
    return {"type": "string", "enum": ["yes", "no", "unknown"], "description": desc + " 'unknown' if the evidence does not settle it."}


SIGNALS = task_spec(
    profitable_ttm=check("Was the company profitable (positive net income) over its last four reported quarters, or last two half-years, combined?"),
    beat_revenue_consensus=check("Did the company's most recently reported revenue exceed the analyst consensus estimate?"),
    customer_over_10pct=check("Does the latest annual report disclose any single customer accounting for 10% or more of revenue?"),
    active_buyback=check("Does the company have an active share repurchase program or authorization?"),
    ceo_or_cfo_change_12m=check("Has the company's CEO or CFO changed in the last 12 months?"),
    material_legal_matter=check("Is the company currently subject to a disclosed government investigation, enforcement action, or material litigation?"),
    outlook_change={
        "type": "string",
        "enum": ["raised", "maintained", "lowered", "no_outlook", "unknown"],
        "description": "What management did with its financial outlook at the most recent results announcement.",
    },
    balance_sheet_strength={
        "type": "string",
        "enum": ["distressed", "stretched", "moderate", "solid", "fortress"],
        "description": (
            "Balance sheet strength at the latest period end, relative to the company's industry. distressed: going-concern "
            "doubt, covenant breach, or debt it cannot service. stretched: high leverage or reliance on refinancing. "
            "moderate: typical leverage, manageable maturities. solid: low leverage, ample liquidity. fortress: large net "
            "cash or capital surplus relative to obligations."
        ),
    },
)

SECTIONS = {"profile": PROFILE, "financials": FINANCIALS, "market": MARKET, "news": NEWS, "signals": SIGNALS}
