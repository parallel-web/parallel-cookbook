"""Minimal cited research with Parallel's OpenAI-compatible Responses API."""

from __future__ import annotations

import argparse
import os
import sys

from openai import OpenAI
from openai.types.responses import Response

PARALLEL_BASE_URL = "https://api.parallel.ai/v1"
DEFAULT_PROMPT = (
    "Compare NVIDIA and AMD's most recently reported quarterly data-center revenue. "
    "Include each reporting period, explain the main difference, and cite your sources."
)

Citation = tuple[str, str]


def create_response(client: OpenAI, prompt: str) -> Response:
    """Run one medium-effort, web-grounded Responses request."""
    if not prompt.strip():
        raise ValueError("The research prompt cannot be empty.")

    return client.responses.create(
        model="parallel",
        input=prompt,
        reasoning={"effort": "medium"},
    )


def parse_response(response: Response) -> tuple[str, list[Citation]]:
    """Return the answer and unique URL citations from a completed response."""
    answer = response.output_text.strip()
    if not answer:
        raise ValueError("Parallel returned an empty answer.")

    citations: list[Citation] = []
    seen_urls: set[str] = set()
    for output in response.output:
        if output.type != "message":
            continue
        for part in output.content:
            if part.type != "output_text":
                continue
            for annotation in part.annotations:
                if annotation.type != "url_citation":
                    continue
                url = annotation.url.strip()
                if not url or url in seen_urls:
                    continue
                citations.append((annotation.title.strip() or "Source", url))
                seen_urls.add(url)

    if not citations:
        raise ValueError("Parallel returned an answer without URL citations.")
    return answer, citations


def render_result(answer: str, citations: list[Citation]) -> str:
    """Render a terminal-friendly answer followed by its sources."""
    source_lines = [
        f"{index}. {title} — {url}"
        for index, (title, url) in enumerate(citations, start=1)
    ]
    return "\n".join([answer, "", "Sources:", *source_lines])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Ask Parallel a current question and print its cited answer."
    )
    parser.add_argument(
        "prompt",
        nargs="?",
        default=DEFAULT_PROMPT,
        help="Research question. Defaults to a current NVIDIA/AMD comparison.",
    )
    args = parser.parse_args(argv)

    api_key = os.environ.get("PARALLEL_API_KEY")
    if not api_key:
        print(
            "Error: PARALLEL_API_KEY is not set. "
            "Export a key from https://platform.parallel.ai.",
            file=sys.stderr,
        )
        return 1

    client = OpenAI(api_key=api_key, base_url=PARALLEL_BASE_URL)
    try:
        response = create_response(client, args.prompt)
        answer, citations = parse_response(response)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(render_result(answer, citations))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
