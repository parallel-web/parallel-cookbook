"""Minimal cited research with Parallel's OpenAI-compatible Responses API."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from typing import Protocol, cast

from openai import OpenAI
from openai.types.responses import Response

PARALLEL_BASE_URL = "https://api.parallel.ai/v1"
DEFAULT_PROMPT = (
    "Compare NVIDIA and AMD's most recently reported quarterly data-center revenue. "
    "Include each reporting period and explain the main difference. Base the answer "
    "only on official NVIDIA and AMD company sources. The response must cite at least "
    "one official NVIDIA URL and at least one official AMD URL; do not cite syndicated "
    "copies."
)


class ResponsesResource(Protocol):
    """The small part of the OpenAI client used by this recipe."""

    def create(self, **kwargs: object) -> Response: ...


class ResponsesClient(Protocol):
    responses: ResponsesResource


class QuickstartError(RuntimeError):
    """Raised when configuration or API output breaks the recipe contract."""


@dataclass(frozen=True)
class Citation:
    title: str
    url: str


def make_client(api_key: str | None = None) -> OpenAI:
    """Create the standard OpenAI client pointed at Parallel."""
    resolved_key = api_key or os.environ.get("PARALLEL_API_KEY")
    if not resolved_key:
        raise QuickstartError(
            "PARALLEL_API_KEY is not set. Export a key from https://platform.parallel.ai."
        )
    return OpenAI(api_key=resolved_key, base_url=PARALLEL_BASE_URL)


def create_response(prompt: str, *, client: ResponsesClient | None = None) -> Response:
    """Run one medium-effort, web-grounded Responses request."""
    if not prompt.strip():
        raise QuickstartError("The research prompt cannot be empty.")

    responses_client = client or make_client()
    return responses_client.responses.create(
        model="parallel",
        input=prompt,
        reasoning={"effort": "medium"},
    )


def extract_citations(response: Response) -> list[Citation]:
    """Collect unique HTTPS URL citations from all output-text parts."""
    citations: list[Citation] = []
    seen_urls: set[str] = set()

    for item in response.output:
        for part in getattr(item, "content", []):
            if getattr(part, "type", None) != "output_text":
                continue
            for annotation in getattr(part, "annotations", []):
                if getattr(annotation, "type", None) != "url_citation":
                    continue

                url = getattr(annotation, "url", "")
                if not isinstance(url, str) or not url.startswith("https://"):
                    continue
                if url in seen_urls:
                    continue

                raw_title = getattr(annotation, "title", "")
                title = raw_title.strip() if isinstance(raw_title, str) else ""
                citations.append(Citation(title=title or "Source", url=url))
                seen_urls.add(url)

    return citations


def validate_response(response: Response) -> tuple[str, list[Citation]]:
    """Require the answer and citations promised by this quickstart."""
    answer = response.output_text.strip()
    if not answer:
        raise QuickstartError("Parallel returned an empty answer.")

    citations = extract_citations(response)
    if not citations:
        raise QuickstartError("Parallel returned an answer without HTTPS citations.")

    return answer, citations


def run_cited_research(
    prompt: str,
    *,
    client: ResponsesClient | None = None,
    max_attempts: int = 3,
) -> tuple[str, list[Citation]]:
    """Return a cited answer, retrying boundedly when basis is absent."""
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")

    responses_client = client or make_client()
    for attempt in range(1, max_attempts + 1):
        response = create_response(prompt, client=responses_client)
        try:
            return validate_response(response)
        except QuickstartError as exc:
            if attempt == max_attempts:
                raise QuickstartError(
                    f"Parallel did not return a cited answer after {max_attempts} "
                    f"attempts: {exc}"
                ) from exc
            print(
                f"Attempt {attempt} did not return a cited answer; "
                f"retrying ({attempt + 1}/{max_attempts}).",
                file=sys.stderr,
            )

    raise AssertionError("unreachable")


def render_result(answer: str, citations: list[Citation]) -> str:
    """Render a terminal-friendly answer followed by its sources."""
    source_lines = [
        f"{index}. {citation.title} — {citation.url}"
        for index, citation in enumerate(citations, start=1)
    ]
    return "\n".join([answer, "", "Sources:", *source_lines])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Ask Parallel a current question and print its cited answer."
    )
    parser.add_argument(
        "prompt",
        nargs="?",
        default=DEFAULT_PROMPT,
        help="Research question. Defaults to a current NVIDIA/AMD comparison.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        answer, citations = run_cited_research(cast(str, args.prompt))
    except QuickstartError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(render_result(answer, citations))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
