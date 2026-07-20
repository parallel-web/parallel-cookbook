from types import SimpleNamespace
from typing import Any, cast

import pytest

from quickstart import (
    DEFAULT_PROMPT,
    QuickstartError,
    create_response,
    extract_citations,
    make_client,
    render_result,
    run_cited_research,
    validate_response,
)


def _annotation(
    url: str,
    *,
    title: str = "Example",
    annotation_type: str = "url_citation",
) -> SimpleNamespace:
    return SimpleNamespace(type=annotation_type, url=url, title=title)


def _response(
    answer: str = "The cited answer.",
    annotations: list[SimpleNamespace] | None = None,
) -> SimpleNamespace:
    text_part = SimpleNamespace(
        type="output_text",
        text=answer,
        annotations=annotations
        if annotations is not None
        else [_annotation("https://example.com/report")],
    )
    return SimpleNamespace(
        output_text=answer,
        output=[SimpleNamespace(type="message", content=[text_part])],
    )


class FakeResponses:
    def __init__(self, response: SimpleNamespace) -> None:
        self.response = response
        self.kwargs: dict[str, object] | None = None

    def create(self, **kwargs: object) -> Any:
        self.kwargs = kwargs
        return self.response


class SequencedResponses:
    def __init__(self, responses: list[SimpleNamespace]) -> None:
        self.responses = iter(responses)
        self.call_count = 0

    def create(self, **kwargs: object) -> Any:
        self.call_count += 1
        return next(self.responses)


def test_create_response_uses_the_locked_request_contract() -> None:
    resource = FakeResponses(_response())
    client = SimpleNamespace(responses=resource)

    result = create_response(DEFAULT_PROMPT, client=cast(Any, client))

    assert result.output_text == "The cited answer."
    assert resource.kwargs == {
        "model": "parallel",
        "input": DEFAULT_PROMPT,
        "reasoning": {"effort": "medium"},
    }


def test_extract_citations_deduplicates_urls_and_ignores_other_annotations() -> None:
    response = _response(
        annotations=[
            _annotation("https://example.com/a", title="First"),
            _annotation("https://example.com/a", title="Duplicate"),
            _annotation("https://example.com/b", title=""),
            _annotation(
                "https://example.com/not-a-citation", annotation_type="file_citation"
            ),
            _annotation("http://example.com/insecure"),
        ]
    )

    citations = extract_citations(cast(Any, response))

    assert [(citation.title, citation.url) for citation in citations] == [
        ("First", "https://example.com/a"),
        ("Source", "https://example.com/b"),
    ]


def test_validate_response_requires_an_answer() -> None:
    with pytest.raises(QuickstartError, match="empty answer"):
        validate_response(cast(Any, _response(answer="   ")))


def test_validate_response_requires_https_citations() -> None:
    with pytest.raises(QuickstartError, match="without HTTPS citations"):
        validate_response(
            cast(Any, _response(annotations=[_annotation("http://example.com")]))
        )


def test_render_result_numbers_sources() -> None:
    answer, citations = validate_response(
        cast(
            Any,
            _response(
                annotations=[
                    _annotation("https://example.com/a", title="A"),
                    _annotation("https://example.com/b", title="B"),
                ]
            ),
        )
    )

    assert render_result(answer, citations) == (
        "The cited answer.\n\n"
        "Sources:\n"
        "1. A — https://example.com/a\n"
        "2. B — https://example.com/b"
    )


def test_run_cited_research_retries_missing_basis(
    capsys: pytest.CaptureFixture[str],
) -> None:
    resource = SequencedResponses(
        [
            _response(annotations=[]),
            _response(annotations=[_annotation("https://example.com/cited")]),
        ]
    )
    client = SimpleNamespace(responses=resource)

    answer, citations = run_cited_research(DEFAULT_PROMPT, client=cast(Any, client))

    assert answer == "The cited answer."
    assert [citation.url for citation in citations] == ["https://example.com/cited"]
    assert resource.call_count == 2
    assert "retrying (2/3)" in capsys.readouterr().err


def test_run_cited_research_stops_after_the_attempt_limit() -> None:
    resource = SequencedResponses([_response(annotations=[])] * 2)
    client = SimpleNamespace(responses=resource)

    with pytest.raises(QuickstartError, match="after 2 attempts"):
        run_cited_research(
            DEFAULT_PROMPT,
            client=cast(Any, client),
            max_attempts=2,
        )

    assert resource.call_count == 2


def test_empty_prompt_fails_before_calling_the_client() -> None:
    resource = FakeResponses(_response())
    client = SimpleNamespace(responses=resource)

    with pytest.raises(QuickstartError, match="cannot be empty"):
        create_response("  ", client=cast(Any, client))

    assert resource.kwargs is None


def test_make_client_requires_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PARALLEL_API_KEY", raising=False)

    with pytest.raises(QuickstartError, match="PARALLEL_API_KEY is not set"):
        make_client()
