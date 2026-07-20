import os

import pytest

from quickstart import DEFAULT_PROMPT, run_cited_research


@pytest.mark.live
def test_responses_api_returns_a_cited_answer() -> None:
    if os.environ.get("RUN_LIVE_TESTS") != "1":
        pytest.skip("set RUN_LIVE_TESTS=1 to opt into the billed live test")
    if not os.environ.get("PARALLEL_API_KEY"):
        pytest.skip("PARALLEL_API_KEY is required for the billed live test")

    answer, citations = run_cited_research(DEFAULT_PROMPT)

    assert "NVIDIA" in answer.upper()
    assert "AMD" in answer.upper()
    assert citations
    assert all(citation.url.startswith("https://") for citation in citations)
