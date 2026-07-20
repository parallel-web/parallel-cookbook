# Parallel Responses API Quickstart

Ask a current, multi-source question with the OpenAI SDK and print a cited,
web-grounded answer from Parallel.

## What it shows

- Use the standard OpenAI Python SDK with Parallel's Responses API.
- Choose the `parallel` model and an explicit reasoning effort.
- Read the answer from `response.output_text`.
- Extract and deduplicate standard `url_citation` annotations.

The first run requires only a Parallel API key. You do not need an OpenAI key.

## Architecture

```text
Your question
    │
    ▼
OpenAI SDK ── base_url=https://api.parallel.ai/v1
    │
    ▼
Parallel Responses API ── live web research at medium effort
    │
    ▼
Answer text + URL citation annotations
```

## Quick Start

Prerequisites: Python 3.10+ and [`uv`](https://docs.astral.sh/uv/).

```bash
cd python-recipes/parallel-responses-quickstart
uv sync
export PARALLEL_API_KEY="your-api-key-here"
uv run python quickstart.py
```

The default question compares NVIDIA and AMD's most recently reported
quarterly data-center revenue and asks Parallel to use only official company
sources. The command prints the grounded answer followed by a numbered source
list:

```text
<grounded comparison of the latest reported quarters>

Sources:
1. <source title> — https://...
2. <source title> — https://...
```

Pass a different question as the optional positional argument:

```bash
uv run python quickstart.py \
  "What changed in the latest stable Python release? Cite the release notes."
```

## The API call

The request itself uses the stock OpenAI SDK:

```python
from openai import OpenAI

client = OpenAI(
    api_key=PARALLEL_API_KEY,
    base_url="https://api.parallel.ai/v1",
)

response = client.responses.create(
    model="parallel",
    input=prompt,
    reasoning={"effort": "medium"},
)

print(response.output_text)
```

Parallel exposes one model, `parallel`. Set `reasoning.effort` to `low`,
`medium`, or `high` to choose the research depth. This quickstart uses
`medium` explicitly.

## Reading citations

Citations are standard Responses API `url_citation` annotations attached to
output-text content parts. `extract_citations()` walks every output item,
keeps HTTPS URL citations, and deduplicates them by URL before rendering the
source list.

The script treats a missing answer or missing citations as a contract error
instead of silently printing an ungrounded-looking result. Citation annotations
depend on the underlying research run's basis and can occasionally be absent,
so the command retries that contract failure up to two times. It prints each
retry to stderr; one invocation can therefore make between one and three billed
Responses calls.

## Migrating an OpenAI Responses call

If your application already uses `client.responses.create(...)`, the core
migration is a small configuration diff:

```diff
- client = OpenAI(api_key=OPENAI_API_KEY)
+ client = OpenAI(
+     api_key=PARALLEL_API_KEY,
+     base_url="https://api.parallel.ai/v1",
+ )

  response = client.responses.create(
-     model="gpt-5.4-mini",
+     model="parallel",
      input=prompt,
      reasoning={"effort": "medium"},
-     tools=[{"type": "web_search"}],
  )
```

Parallel performs web research automatically, so callers do not configure a
separate `web_search` tool.

## Verification

Run the deterministic tests, which use local fixtures and make no network
calls:

```bash
uv run pytest -m "not live"
```

The billed live smoke test is doubly opt-in: it requires both a key and an
explicit flag. Because it exercises the same bounded retry path as the command,
it can make up to three Responses calls.

```bash
PARALLEL_API_KEY="your-api-key-here" \
RUN_LIVE_TESTS=1 \
uv run pytest -m live -v
```

The live test verifies that the response mentions both companies and includes
at least one valid HTTPS citation. It intentionally does not freeze financial
figures that will become stale.

## License

MIT
