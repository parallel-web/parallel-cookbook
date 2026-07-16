"""The Slack message format — pinned to the digest spec so regressions
in field order, the investor sub-bullet, or the Fit line fail loudly."""

import json

from backend import investor_core as core
from backend.crm import pipeline_label


def _text_of(blocks) -> str:
    return json.dumps(blocks, ensure_ascii=False)


def test_header_carries_company_stage_amount(sample_signal):
    blocks = core.build_signal_blocks(sample_signal)
    header = blocks[0]
    assert header["type"] == "header"
    assert "Acme Robotics — Series A, $25M" in header["text"]["text"]


def test_lead_investor_after_colon_with_followons_as_subbullet(sample_signal):
    text = _text_of(core.build_signal_blocks(sample_signal))
    assert "*Lead Investor(s):* Example Ventures" in text
    assert "◦ Also in round: Sample Capital, Angel One" in text


def test_fit_shows_reasoning_only_never_the_numeric_rating(sample_signal):
    text = _text_of(core.build_signal_blocks(sample_signal))
    assert "*Fit:* Agents need fresh web data" in text
    assert "/10" not in text
    assert "(auto)" not in text


def test_sections_are_blank_line_separated(sample_signal):
    facts_block = next(
        b for b in core.build_signal_blocks(sample_signal)
        if b["type"] == "section" and "Lead Investor(s)" in b["text"]["text"]
    )
    assert "\\n\\n" in json.dumps(facts_block["text"]["text"])


def test_enrich_button_deep_links_into_the_app(sample_signal):
    blocks = core.build_signal_blocks(sample_signal)
    actions = next(b for b in blocks if b["type"] == "actions")
    url = actions["elements"][0]["url"]
    assert url == "https://example.test/?q=acme.ai"


def test_pipeline_line_links_to_crm_when_in_pipeline(sample_signal):
    s = {
        **sample_signal,
        "pipeline_label": "In Pipeline (Attio) — 1 active deal — owner: Sam Rep",
        "crm_url": "https://app.attio.com/ws/company/rid/overview",
    }
    text = _text_of(core.build_signal_blocks(s))
    assert "<https://app.attio.com/ws/company/rid/overview|In Pipeline (Attio)" in text


def test_na_fields_are_omitted_not_rendered(sample_signal):
    s = {**sample_signal, "founders": "NA", "investing_partner": "NA", "sector": "NA"}
    text = _text_of(core.build_signal_blocks(s))
    assert "Founders" not in text
    assert "Intro Path" not in text
    assert "*Sector:*" not in text


def test_sources_are_numbered_links_capped_at_five(sample_signal):
    s = {**sample_signal, "sources": [f"https://s{i}.example" for i in range(9)]}
    text = _text_of(core.build_signal_blocks(s))
    assert "[5]" in text and "[6]" not in text


def test_weekly_digest_is_one_message_with_all_startups(sample_signal):
    other = {**sample_signal, "company": "Globex", "priority": "digest"}
    result_blocks = []
    posted_texts = []

    def fake_post(blocks, text):
        result_blocks.append(blocks)
        posted_texts.append(text)
        return True

    original = core.post_to_slack
    core.post_to_slack = fake_post
    try:
        core.slack_enabled = lambda: True
        out = core.post_weekly_digest_sync("July 6", [sample_signal, other])
    finally:
        core.post_to_slack = original

    assert out["mode"] == "single-message"
    assert out["posted"] == 1  # ONE message, not one per startup
    text = json.dumps(result_blocks[0])
    assert "Week of July 6" in text
    assert "Acme Robotics" in text and "Globex" in text


def test_pipeline_label_permutations():
    assert pipeline_label(None, True).startswith("On your known-companies list")
    assert pipeline_label({"in_crm": False, "deal_count": 0, "owner": None, "record_id": None, "url": None}, False) == "Not in Pipeline"
    label = pipeline_label(
        {"in_crm": True, "deal_count": 2, "owner": "Sam Rep", "record_id": "r", "url": "u"},
        True,
    )
    assert "In Pipeline (Attio)" in label
    assert "2 active deals" in label
    assert "owner: Sam Rep" in label
