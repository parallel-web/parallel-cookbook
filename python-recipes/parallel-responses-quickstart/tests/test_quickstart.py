from types import SimpleNamespace
from typing import Any, cast

import pytest

from quickstart import (
    DEFAULT_PROMPT,
    create_response,
    main,
    parse_response,
    render_result,
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


def test_create_response_uses_the_locked_request_contract() -> None:
    resource = FakeResponses(_response())
    client = SimpleNamespace(responses=resource)

    result = create_response(cast(Any, client), DEFAULT_PROMPT)

    assert result.output_text == "The cited answer."
    assert resource.kwargs == {
        "model": "parallel",
        "input": DEFAULT_PROMPT,
        "reasoning": {"effort": "medium"},
    }


def test_parse_response_deduplicates_urls_and_ignores_other_annotations() -> None:
    response = _response(
        annotations=[
            _annotation("https://example.com/a", title="First"),
            _annotation("https://example.com/a", title="Duplicate"),
            _annotation("http://example.com/b", title=""),
            _annotation(
                "https://example.com/not-a-citation", annotation_type="file_citation"
            ),
        ]
    )

    answer, citations = parse_response(cast(Any, response))

    assert answer == "The cited answer."
    assert citations == [
        ("First", "https://example.com/a"),
        ("Source", "http://example.com/b"),
    ]


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (_response(answer="   "), "empty answer"),
        (_response(annotations=[]), "without URL citations"),
    ],
)
def test_parse_response_rejects_incomplete_results(
    response: SimpleNamespace, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        parse_response(cast(Any, response))


def test_render_result_numbers_sources() -> None:
    assert render_result(
        "The cited answer.",
        [("A", "https://example.com/a"), ("B", "https://example.com/b")],
    ) == (
        "The cited answer.\n\n"
        "Sources:\n"
        "1. A — https://example.com/a\n"
        "2. B — https://example.com/b"
    )


def test_empty_prompt_fails_before_calling_the_client() -> None:
    resource = FakeResponses(_response())
    client = SimpleNamespace(responses=resource)

    with pytest.raises(ValueError, match="cannot be empty"):
        create_response(cast(Any, client), "  ")

    assert resource.kwargs is None


def test_main_requires_a_key(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("PARALLEL_API_KEY", raising=False)

    assert main([]) == 1
    assert "PARALLEL_API_KEY is not set" in capsys.readouterr().err
