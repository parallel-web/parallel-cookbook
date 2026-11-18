"""What to research: the Task API output schemas for each section of a drug asset profile.

Ask for facts, compute the rest. Each run reports identifiers, dates and numbers
as its sources print them. Python then checks the identifiers against their
registries (ClinicalTrials.gov, PubMed, Drugs@FDA, DailyMed) and computes anything
derived, such as exclusivity end dates or whether a result is significant.
"""

from __future__ import annotations


def s(desc: str) -> dict:
    return {"type": "string", "description": desc}


def n(desc: str) -> dict:
    return {"anyOf": [{"type": "number"}, {"type": "null"}], "description": desc + " Null if not available."}


def enum(desc: str, *values: str) -> dict:
    return {"type": "string", "enum": list(values), "description": desc}


def obj(desc: str, **props: dict) -> dict:
    return {"type": "object", "description": desc, "properties": props, "required": list(props), "additionalProperties": False}


def arr(desc: str, item: dict) -> dict:
    return {"type": "array", "description": desc, "items": item}


def task_spec(**fields: dict) -> dict:
    return {
        "input_schema": {"type": "json", "json_schema": ASSET},
        "output_schema": {"type": "json", "json_schema": obj("Drug asset profile section.", **fields)},
    }


ASSET = obj(
    "A drug asset.",
    asset=s("Drug name as given: brand name, generic name (INN) or development code."),
    sponsor=s("Company that owns or leads development of the asset."),
    focus_indication=s("Indication to focus trials and evidence on. Empty means the asset's lead indication."),
)

DATE = "YYYY-MM-DD, or YYYY-MM if only the month is published"

# ----------------------------------------------------------------------------- identity (ChEMBL)

IDENTITY = task_spec(
    generic_name=s("International nonproprietary name (INN), lowercase, e.g. semaglutide. 'None assigned' if the asset only has a code."),
    brand_names=arr(
        "Brand names the asset is approved under in the United States, European Union, China and Japan only, one entry "
        "per brand and region. Leave a region out unless the asset is approved there. Empty if it is approved nowhere.",
        obj("A brand.", name=s("Brand name, in Latin script where one exists."), region=enum("Region.", "United States", "European Union", "China", "Japan")),
    ),
    development_codes=arr("Sponsor development codes, e.g. BAN2401, LY3298176.", s("A code.")),
    originator=s("Company that discovered or first developed the asset."),
    rights_holders=arr(
        "Companies that hold development or commercial rights today, with the territory or role.",
        obj("A rights holder.", company=s("Company name."), rights=s("Territory or role, one short phrase, e.g. 'worldwide except China', 'US co-promotion'.")),
    ),
    modality=enum(
        "Drug modality.",
        "small molecule", "monoclonal antibody", "bispecific antibody", "antibody-drug conjugate", "peptide",
        "protein or enzyme", "oligonucleotide", "cell therapy", "gene therapy", "vaccine", "other",
    ),
    targets=arr("Molecular targets as HGNC gene symbols with the common name, e.g. GLP1R, PDCD1 (PD-1), APP (amyloid beta).", s("A target.")),
    mechanism_of_action=s("One sentence a clinician would accept on how the drug works."),
    route=s("Route of administration, e.g. oral tablet, subcutaneous injection, intravenous infusion."),
    chembl_id=s("ChEMBL molecule ID, e.g. CHEMBL4297588. 'Not found' if ChEMBL has no record."),
    highest_stage=enum(
        "Highest development stage reached anywhere in the world.",
        "approved", "filed", "phase 3", "phase 2", "phase 1", "preclinical", "withdrawn from market", "discontinued",
    ),
)

# ----------------------------------------------------------------------------- regulatory (regulator sites only)

STATUS = ("approved", "under review", "complete response letter", "not filed", "withdrawn", "unknown")


def region(desc: str, **extra: dict) -> dict:
    return obj(
        desc,
        status=enum(
            "Marketing authorization status today. 'complete response letter' if the regulator declined the first "
            "application and the asset is not approved; an approved asset stays 'approved' even if a later "
            "supplement was declined.",
            *STATUS,
        ),
        first_approval_date=s(f"Date of the first marketing authorization, {DATE}. Empty if not approved."),
        approved_indications=arr(
            "Every approved indication, including each later supplemental approval for a new indication or line of "
            "therapy, as a short phrase with the date it was approved, oldest first. Empty if not approved.",
            obj("An indication.", indication=s("Indication, one short phrase."), approval_date=s(f"Approval date, {DATE}.")),
        ),
        **extra,
    )


REGULATORY = task_spec(
    us=region(
        "United States, from FDA and DailyMed.",
        application_number=s("FDA application number with its type, e.g. BLA761269 or NDA215866. Empty if not approved."),
        approval_pathways=arr(
            "Expedited programs and designations this application used, e.g. accelerated approval, priority review, "
            "breakthrough therapy, fast track, orphan drug. Empty if none.",
            s("A pathway."),
        ),
        conversion_to_traditional_date=s(f"If first approved under accelerated approval, the date it converted to traditional approval, {DATE}. Empty otherwise."),
        boxed_warning=s("Subject of the boxed warning in the current US prescribing information, e.g. 'amyloid-related imaging abnormalities'. 'None' if there is no boxed warning."),
        dailymed_setid=s("DailyMed set ID (a UUID like 9d1ff786-e577-410a-a273-c4d7d0e4e975) of the current US prescribing information. Empty if none."),
        label_revision_date=s("Revision date printed on the current US prescribing information, YYYY-MM. Empty if none."),
    ),
    eu=region("European Union, from the EMA.", ema_product_number=s("EMA product number, e.g. EMEA/H/C/005966. Empty if none.")),
    china=region(
        "China, from the NMPA and CDE. Search their Chinese-language pages (药品批准证明文件送达信息, 新药上市) "
        "by the Chinese generic name as well as in English; each new indication is a separate approval notice.",
        nmpa_approval_number=s("NMPA approval number (国药准字), e.g. S20240012. Empty if not approved."),
    ),
    japan=region("Japan, from the PMDA or MHLW, including their Japanese-language pages."),
)

REGULATOR_DOMAINS = ["fda.gov", "dailymed.nlm.nih.gov", "ema.europa.eu", "nmpa.gov.cn", "cde.org.cn", "pmda.go.jp", "mhlw.go.jp"]

# ----------------------------------------------------------------------------- trials (ClinicalTrials.gov)

TRIAL_STATUS = (
    "not yet recruiting", "recruiting", "enrolling by invitation", "active, not recruiting",
    "completed", "suspended", "terminated", "withdrawn", "unknown",
)

TRIAL = obj(
    "A registered clinical trial.",
    nct_id=s("ClinicalTrials.gov identifier, NCT and 8 digits. Empty if the trial is not on ClinicalTrials.gov."),
    other_registry_id=s("Identifier in another registry (e.g. CTR20210000 on chinadrugtrials.org.cn, EU CT number), or empty."),
    acronym=s("Trial acronym or short name, e.g. CLARITY AD. Empty if none."),
    phase=enum("Phase as registered.", "phase 1", "phase 1/2", "phase 2", "phase 2/3", "phase 3", "phase 4"),
    indication=s("Condition studied, one short phrase."),
    comparator=s("Comparator arm, e.g. placebo, pembrolizumab, standard of care. 'None' for single-arm trials."),
    primary_endpoint=s("Primary endpoint, one phrase with its timepoint, e.g. 'change in CDR-SB at 18 months'."),
    enrollment=n("Actual enrollment, or anticipated enrollment if the trial is still recruiting."),
    status=enum("Overall recruitment status as registered.", *TRIAL_STATUS),
    start_date=s(f"Study start date, {DATE}."),
    primary_completion_date=s(f"Primary completion date, actual or anticipated, {DATE}."),
    lead_sponsor=s("Lead sponsor as registered."),
)

TRIALS = task_spec(
    pivotal_trials=arr(
        "Phase 3 trials (or the phase 2 trial an approval rested on) of the asset in the focus indication that support "
        "an approval or a filing in any region, or are designed to, including global registrational trials run by a "
        "licensing partner. Up to five, most important first.",
        TRIAL,
    ),
    ongoing_trials=arr(
        "Other phase 2 or phase 3 trials of the asset, in any indication, that are not yet completed and are not "
        "listed as pivotal. Up to six, most important first: phase 3 before phase 2, and trials led by the sponsor or "
        "a licensing partner before investigator-initiated trials.",
        TRIAL,
    ),
)

# ----------------------------------------------------------------------------- evidence (PubMed)

EVIDENCE = task_spec(
    pivotal_results=arr(
        "Primary-endpoint results of the pivotal trials in the focus indication, each from its peer-reviewed primary "
        "publication. Up to three, most important first.",
        obj(
            "A pivotal result.",
            trial=s("Trial acronym or name."),
            nct_id=s("ClinicalTrials.gov identifier, or empty."),
            pmid=s("PubMed ID of the primary results publication, digits only. Empty if not published in a journal yet."),
            journal=s("Journal name, e.g. N Engl J Med."),
            publication_year=n("Year the primary results paper was published."),
            primary_endpoint=s("Primary endpoint as defined in the paper, with its timepoint."),
            effect_measure=enum(
                "Statistic the paper uses for the primary comparison.",
                "difference in means", "difference in proportions", "hazard ratio", "odds ratio", "risk ratio", "rate ratio", "other",
            ),
            estimate=n("Point estimate of the treatment effect versus the comparator for the primary endpoint, as printed in the paper."),
            ci_lower=n("Lower bound of the 95% confidence interval for that estimate, as printed. Null if the paper reports no 95% CI."),
            ci_upper=n("Upper bound of the 95% confidence interval for that estimate, as printed. Null if the paper reports no 95% CI."),
            p_value=s("P value for the primary comparison exactly as printed, e.g. 'P<0.001' or '0.03'. Empty if none is reported."),
            result_summary=s("One sentence for a clinician: the result in plain numbers versus the comparator."),
        ),
    ),
    key_safety=arr(
        "Up to four of the most clinically important adverse events or safety findings from the pivotal trials or the "
        "label, with incidence on drug and on the comparator where reported.",
        obj(
            "A safety finding.",
            finding=s("Adverse event or safety finding."),
            drug_incidence=s("Incidence on the drug, e.g. '12.6%'. Empty if not reported."),
            comparator_incidence=s("Incidence on the comparator, e.g. '1.7%'. Empty if not reported."),
        ),
    ),
)

# ----------------------------------------------------------------------------- news (open web, last 12 months)

ACTIONS = (
    "submission", "filing accepted", "designation", "advisory committee", "approval", "new indication approved",
    "new formulation or regimen approved", "label change", "complete response letter", "refusal or withdrawal", "other",
)

NEWS = task_spec(
    regulatory_actions=arr(
        "Regulatory actions on the asset in the last 12 months in any region, newest first: submissions, filing "
        "acceptances, designations, advisory committee meetings, approvals, new indications, label changes, complete "
        "response letters, refusals and withdrawals. Up to eight.",
        obj(
            "A regulatory action.",
            date=s(f"Date of the action, or of the announcement if the action date is not public, {DATE}."),
            region=enum("Region.", "us", "eu", "china", "japan", "other"),
            action=enum("Kind of action. 'approval' only for the asset's first approval in that region.", *ACTIONS),
            detail=s("One sentence: what happened, for which indication."),
        ),
    ),
    pending_decisions=arr(
        "Regulatory decisions expected but not yet made, such as an FDA target action (PDUFA) date or an expected CHMP "
        "opinion. Up to four, soonest first. Empty if none is public.",
        obj(
            "A pending decision.",
            region=enum("Region.", "us", "eu", "china", "japan", "other"),
            expected_date=s(f"Expected date, {DATE}, or a quarter like 2027-Q1."),
            decision=s("One sentence: the decision and the indication."),
        ),
    ),
    recent_developments=arr(
        "Up to five other material developments in the last 12 months, newest first: trial readouts, licensing deals, "
        "launches, pricing, supply or safety news.",
        obj("A development.", date=s(f"Date, {DATE}."), headline=s("Headline, under 10 words."), detail=s("One sentence on what happened and why it matters.")),
    ),
)

NEWS_WINDOW_DAYS = 365

# ----------------------------------------------------------------------------- market (CMS Coverage + web)

MARKET = task_spec(
    us_exclusivity=obj(
        "US exclusivity. Empty lists if the asset is not approved in the US.",
        listed_exclusivities=arr(
            "Regulatory exclusivities listed in FDA's Orange Book (drugs) or Purple Book (biologics), with expiry dates. "
            "Include reference product exclusivity only if the Purple Book publishes an expiry date for this product.",
            obj("An exclusivity.", kind=s("Exclusivity type as listed, e.g. NCE, ODE, NI, reference product exclusivity."), expiry_date=s(f"Expiry date, {DATE}.")),
        ),
        patents=arr(
            "Patents listed in the Orange Book for this product, or for a biologic the key composition-of-matter "
            "patents. Up to six, latest expiry first.",
            obj(
                "A patent.",
                patent_number=s("US patent number, digits only, e.g. 10350240."),
                expiry_date=s(f"Expiry date, including any extension, {DATE}."),
                covers=s("What it claims: compound, formulation, method of use, or other."),
            ),
        ),
        expected_competition=s(
            "Earliest expected US generic or biosimilar entry and its basis (e.g. a litigation settlement), one sentence. "
            "'Not known' if nothing has been disclosed."
        ),
    ),
    medicare=obj(
        "Medicare coverage in the US.",
        benefit=enum("Medicare benefit that pays for the drug.", "Part B", "Part D", "both", "not covered", "not applicable"),
        national_coverage_determination=s("Number and title of a national coverage determination that governs coverage, e.g. 'NCD 200.3 ...'. 'None' if none applies."),
        coverage_conditions=s("One sentence on conditions Medicare attaches, such as coverage with evidence development in a registry. 'None' if none."),
    ),
    us_list_price=obj(
        "US list price.",
        annual_wac_usd=n("Wholesale acquisition cost (list price) for one year of maintenance therapy, in US dollars."),
        basis=s("What the figure covers and where it comes from, one phrase, e.g. 'sponsor press release, 10 mg/kg every two weeks'."),
        as_of=s(f"Date of the price, {DATE}."),
    ),
    latest_annual_sales=obj(
        "Most recent full-year worldwide net sales of the asset.",
        amount_m=n("Net sales in millions of the reporting currency."),
        currency=s("ISO 4217 currency code, e.g. USD, EUR, JPY, CNY."),
        period=s("Fiscal year, e.g. FY2025."),
    ),
    competitors=arr(
        "Up to five approved or phase 3 drugs that compete with the asset in the focus indication.",
        obj("A competitor.", drug=s("Drug name, brand (generic) where approved."), sponsor=s("Sponsor."), stage=s("approved, filed or phase 3.")),
    ),
)

# ----------------------------------------------------------------------------- outlook (second stage)

OUTLOOK = {
    "input_schema": {
        "type": "json",
        "json_schema": obj(
            "A drug asset and facts already researched about it.",
            asset=s("Drug name."),
            sponsor=s("Sponsor."),
            focus_indication=s("Focus indication, or empty."),
            facts=s("JSON of researched facts: identity, regulatory status, recent news, trials, evidence and market."),
        ),
    },
    "output_schema": {
        "type": "json",
        "json_schema": obj(
            "Asset outlook.",
            summary=s(
                "Three sentences a pharma strategy or business-development analyst would put at the top of an asset "
                "profile: what the asset is and where it stands, the evidence behind it, and the main open question. "
                "Grounded in the facts provided and in current sources."
            ),
            differentiation=arr("Three points on how the asset differs from its competitors, each grounded in a specific fact or number.", s("A point.")),
            risks=arr("Three or four risks to the asset's value: clinical, regulatory, commercial or exclusivity. One sentence each.", s("A risk.")),
            upcoming_catalysts=arr(
                "Three to five events in the next 12 months that could change the asset's value: regulatory decisions, "
                "data readouts, launches, label changes, competitor approvals, patent or pricing events. Soonest first. "
                "Leave out routine registry dates that no one will announce.",
                obj("A catalyst.", expected_date=s(f"Expected date or month, {DATE}, or a quarter like 2027-Q1."), event=s("The event, one sentence.")),
            ),
        ),
    },
}

SECTIONS = {"identity": IDENTITY, "regulatory": REGULATORY, "news": NEWS, "trials": TRIALS, "evidence": EVIDENCE, "market": MARKET}

# Free Data Connectors each section may call, alongside the open web.
CONNECTORS = {"identity": ["chembl"], "trials": ["clinical_trials"], "evidence": ["pubmed", "clinical_trials"], "market": ["cms_coverage"]}
