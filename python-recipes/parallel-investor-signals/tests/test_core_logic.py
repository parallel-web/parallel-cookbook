"""Unit tests for the pipeline's pure logic: credibility rule, priority
policy, company normalization, email inference, and the strict date gate."""

from datetime import UTC, datetime, timedelta

from backend import investor_core as core
from backend import parallel_client as pc
from backend.signals_service import within_last_days


# ---------------------------------------------------------------- priority ---
def test_seed_a_weighted_over_series_b():
    # identical raise + fit: Seed/A must outrank B ("gems are earlier")
    seed = core.priority_for("Seed", 15, 7, known_portco=False)
    series_b = core.priority_for("Series B", 15, 7, known_portco=False)
    assert seed == "high"
    assert series_b in ("medium", "digest")


def test_small_seed_low_fit_lands_in_digest():
    assert core.priority_for("Seed", 2, 2, known_portco=True) == "digest"


def test_net_new_gets_a_bonus():
    known = core.priority_for("Series A", 10, 6, known_portco=True)
    new = core.priority_for("Series A", 10, 6, known_portco=False)
    order = {"digest": 0, "medium": 1, "high": 2}
    assert order[new] >= order[known]


def test_unknown_stage_is_middling_not_crash():
    assert core.priority_for("", 0, 0, known_portco=True) == "digest"


# ---------------------------------------------------------- normalization ----
def test_norm_company_strips_legal_suffixes_and_punctuation():
    assert core.norm_company("Acme Robotics, Inc.") == "acme robotics"
    assert core.norm_company("Globex  LLC") == "globex"
    assert core.norm_company("Initech AI") == "initech"


def test_is_known_portco_matches_normalized():
    portfolio = {"acme robotics": {"name": "Acme Robotics"}}
    assert core.is_known_portco("ACME ROBOTICS, INC.", portfolio)
    assert not core.is_known_portco("Wayne Enterprises", portfolio)


# ------------------------------------------------------- credibility rule ----
class _FB:
    def __init__(self, citations, confidence="high"):
        self.citations = citations
        self.confidence = confidence


class _Cit:
    def __init__(self, url, excerpts=None):
        self.url = url
        self.excerpts = excerpts or []


def test_uncited_values_are_nulled_never_fabricated():
    field = pc._field("Some plausible value", None)  # no basis at all
    assert field == {"value": None, "confidence": None, "citations": []}


def test_cited_values_survive_with_confidence():
    fb = _FB([_Cit("https://src.example", ["quote"])])
    field = pc._field("Cited value", fb)
    assert field["value"] == "Cited value"
    assert field["confidence"] == "high"
    assert field["citations"][0]["url"] == "https://src.example"


def test_empty_and_na_values_are_nulled_even_with_citations():
    fb = _FB([_Cit("https://src.example")])
    for empty in ("", "N/A", "unknown", None, []):
        assert pc._field(empty, fb)["value"] is None


def test_custom_answers_never_fall_back_to_the_wrong_question():
    defs = [{"question": "Question one?"}, {"question": "Question two?"}]
    answers = [{"question": "Question two?", "answer": "Answer two"}]

    assert pc._match_answers_to_defs(defs, answers, {}) == [
        (None, None),
        ("Answer two", None),
    ]


# ------------------------------------------------------------- email rule ----
def test_inferred_email_is_pattern_based_and_marked():
    field = pc._infer_email("Ada Lovelace", "acme.ai")
    assert field["value"] == "ada.lovelace@acme.ai"
    assert field["confidence"] == "inferred"
    assert field["citations"] == []


def test_inferred_email_requires_full_name_and_domain():
    assert pc._infer_email("Ada", "acme.ai")["value"] is None
    assert pc._infer_email("Ada Lovelace", None)["value"] is None


# ----------------------------------------------------------- strict window ---
def test_within_last_days_accepts_fresh_dates():
    now = datetime(2026, 7, 10, tzinfo=UTC)
    assert within_last_days("2026-07-08", 7, now=now)


def test_within_last_days_rejects_old_dates():
    now = datetime(2026, 7, 10, tzinfo=UTC)
    assert not within_last_days("2026-05-20", 7, now=now)  # backfill-era round


def test_within_last_days_excludes_unparseable_dates():
    # "100% sure": no date means NOT included — never assumed fresh
    assert not within_last_days("NA", 7)
    assert not within_last_days("", 7)
    assert not within_last_days("last Tuesday", 7)


def test_within_last_days_boundary():
    now = datetime(2026, 7, 10, tzinfo=UTC)
    exactly = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    assert within_last_days(exactly, 7, now=now)
