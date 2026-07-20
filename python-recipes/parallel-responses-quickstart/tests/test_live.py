import os

import pytest

from openai import OpenAI

from quickstart import (
    DEFAULT_PROMPT,
    PARALLEL_BASE_URL,
    create_response,
    parse_response,
)


@pytest.mark.live
def test_responses_api_returns_a_cited_answer() -> None:
    if os.environ.get("RUN_LIVE_TESTS") != "1":
        pytest.skip("set RUN_LIVE_TESTS=1 to opt into the billed live test")
    if not os.environ.get("PARALLEL_API_KEY"):
        pytest.skip("PARALLEL_API_KEY is required for the billed live test")

    client = OpenAI(
        api_key=os.environ["PARALLEL_API_KEY"],
        base_url=PARALLEL_BASE_URL,
    )
    response = create_response(client, DEFAULT_PROMPT)
    answer, citations = parse_response(response)

    assert "NVIDIA" in answer.upper()
    assert "AMD" in answer.upper()
    assert citations
    assert all(url.startswith(("http://", "https://")) for _, url in citations)
