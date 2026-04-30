# Building a due diligence agent with Deep Agents and Parallel

**A research agent that reasons over its own confidence and chains follow-up queries when it isn't sure.**

Most research agents do one search, take what they get, and move on. This recipe shows a different pattern: an agent that examines the confidence of its own findings and chains follow-up queries when a result is uncertain. Deep Agents handles the orchestration — planning, subagent delegation, virtual filesystem. Parallel's Task API returns structured findings with per-field citations and calibrated confidence via Basis. Parallel's `previous_interaction_id` lets the agent pick up where a prior query left off — context preserved, follow-up question added.

The worked example is **company due diligence**: take a target, investigate it across five dimensions in parallel, produce a structured report where every claim has a source trail. DD shows up in PE deal screening, credit underwriting, KYB onboarding, M&A target evaluation, and vendor risk. But the pattern underneath — typed-output research with confidence-driven follow-ups — works for any multi-source research task: newsletter prep, lead generation, comparison shopping, market sizing, candidate background checks. Swap the subagents and you have a different agent.

## Overview

The agent runs in three phases — Phase 2 fans out a per-competitor subagent, which is where the Deep Agents harness's context-isolation pattern earns its keep.

**Phase 1** — five subagents run in parallel:

- **Corporate profile** — legal entity structure, key officers, founding history, headcount, office locations.
- **Financial health** — funding history, revenue signals, valuation indicators, profitability markers.
- **Litigation and regulatory** — lawsuits, SEC filings, sanctions screening, regulatory actions, settlements.
- **News and reputation** — recent press coverage, leadership changes, controversy flags, media sentiment.
- **Competitive landscape** — identifies the target's top 3–5 competitors and positioning. Does NOT investigate each competitor — that's Phase 2.

**Phase 2 — competitor fan-out**: once `competitive-landscape` returns the named list, the orchestrator dispatches a separate `competitor-analysis` subagent **once per competitor**, in parallel. Each instance runs in its own isolated context, produces a focused profile of that competitor (corporate snapshot, revenue, positioning vs. the target, recent strategic moves, strengths/weaknesses), and writes to its own `competitor-<slug>.md` workpaper. This is the canonical Deep Agents pattern: spawning N instances of the same subagent type for N parallel investigations.

**Phase 3** — the orchestrator reads every workpaper (the five Phase-1 files plus all `competitor-<slug>.md` files), cross-references for contradictions and low-confidence findings, runs ad-hoc lookups via `ParallelWebSearchTool` where needed, and synthesizes the final memo with a comparative competitor section.

DD requires this multi-step architecture because earlier findings change what needs to be investigated next. If `corporate-profile` reveals the target is a subsidiary, financial analysis covers the parent. If `competitive-landscape` returns 4 competitors, Phase 2 spawns 4 parallel investigations rather than packing everything into one mega-call. Deep Agents' `write_todos` planner sequences this naturally.

Each research call uses a `pro-fast` processor Task API call by default — deeper reasoning per call than `core-fast`, agent-loop friendly latency. See [Parallel pricing](https://docs.parallel.ai/getting-started/pricing) for current rates.

## Run it

```bash
# Using uv (recommended)
uv venv
uv pip install -r requirements.txt

cp .env.example .env  # then fill in your keys

uv run python agent.py "Rivian Automotive"
```

Stream progress in real time:

```python
from agent import stream

stream("Rivian Automotive")
```

Or interactively in the [notebook](due_diligence.ipynb).

To run inside LangGraph dev server:

```bash
uv run langgraph dev
```

The provided `langgraph.json` exposes the agent under the graph id `due_diligence`.

## How it works

### The `research_task` tool

Every subagent calls a single tool that wraps Parallel's Task API and surfaces Basis metadata for the agent to reason over:

```python
from langchain_core.tools import tool
from langchain_parallel import ParallelTaskRunTool, parse_basis

@tool
def research_task(query: str, output_description: str, previous_interaction_id: str | None = None) -> dict:
    """Run structured web research via Parallel's Task API.

    Returns findings with per-field citations and confidence scores (Basis).
    Use previous_interaction_id to chain follow-up queries that build on
    prior research context.
    """
    runner = ParallelTaskRunTool(
        processor="pro-fast",
        task_output_schema=output_description,
    )
    invoke_args: dict = {"input": query}
    if previous_interaction_id:
        invoke_args["previous_interaction_id"] = previous_interaction_id

    result = runner.invoke(invoke_args)
    parsed = parse_basis(result)

    output = result["output"]
    findings = output.get("content") if isinstance(output, dict) else output

    response: dict = {
        "findings": findings,
        "citations_by_field": parsed["citations_by_field"],
        "interaction_id": parsed["interaction_id"],
    }
    if parsed["low_confidence_fields"]:
        response["low_confidence_warning"] = (
            "These fields came back with low confidence and should be verified, "
            "ideally by chaining a follow-up query with previous_interaction_id: "
            + ", ".join(parsed["low_confidence_fields"])
        )
    return response
```

The wrapper does three things on top of the SDK call:

1. **Routes** through `ParallelTaskRunTool` — agent-friendly invocation that blocks until the Task completes and returns the structured result.
2. **Parses Basis** via `parse_basis`, which extracts `citations_by_field` and `low_confidence_fields` from the result.
3. **Surfaces a warning** when any field came back at low confidence, so the subagent's reasoning can decide to chain a follow-up query using the returned `interaction_id`.

This is the canonical "use the SDK + Basis" pattern. It's small enough to read in one screen and copy into other agents.

### Subagents and the orchestrator

Each subagent gets a focused system prompt and the `research_task` tool. See [`agent.py`](agent.py) for the full prompts; here is the shape of one:

```python
from deepagents import create_deep_agent

corporate_profile_subagent = {
    "name": "corporate-profile",
    "description": "Research corporate structure, leadership, founding history, and headcount",
    "system_prompt": """You are a corporate research analyst.

Use the research_task tool to find: legal entity name, current CEO and key
executives, headquarters, employee headcount, corporate structure...

If the result includes a low_confidence_warning, run a follow-up query using
the returned interaction_id to verify the flagged fields specifically.""",
    "tools": [research_task],
}
```

The orchestrator uses Deep Agents' built-in `write_todos` planner, the `task` tool to dispatch subagents in parallel, the virtual filesystem to read each subagent's workpaper, and `ParallelWebSearchTool` for ad-hoc lookups when contradictions surface. It synthesizes the final report with explicit confidence-and-verification notes and a list of risk flags requiring further investigation.

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[quick_search],
    subagents=[
        corporate_profile_subagent,
        financial_health_subagent,
        litigation_subagent,
        news_reputation_subagent,
        competitive_landscape_subagent,
    ],
    system_prompt=DILIGENCE_INSTRUCTIONS,
)
```

## Cost and latency

A typical full run produces 8–12 Task API calls — five Phase-1 tracks (one packed call each plus a couple of chained follow-ups on low-confidence findings) plus three Phase-2 competitor-analysis instances. The Rivian sample in [`sample_output_rivian.md`](sample_output_rivian.md) was generated at the default `pro-fast` tier.

| Tier | Per-run estimate | When to use |
|---|---|---|
| `core-fast` | ~$0.75–1.50, ~15–25 min | Faster draft, useful for iterating on prompts |
| `pro-fast` per subagent (default) | depends on processor pricing | Higher-stakes DD with deeper reasoning per call |
| `core` per subagent | ~$1–2, ~25–40 min | Deeper non-`-fast` variant of `core` |
| Tier-up to `pro-fast` | ~$3–6, ~25–45 min | Higher-stakes DD with richer reasoning per track |
| Tier-up to `ultra` | ~$30–80, 90–180 min | Investment-committee-grade output |

Update the `processor` argument inside `research_task` to switch tiers, or override per-subagent if some tracks (e.g. financial-health) warrant more depth than others. The `-fast` variants of any tier are 2–5× faster at similar accuracy and are the right pick for agent-in-the-loop interaction; drop the `-fast` suffix when you want maximum quality and don't mind waiting.

The agent uses a **disk-backed filesystem** (`FilesystemBackend(root_dir="./reports", virtual_mode=True)`) so workpapers and the long-form memo are written to your local filesystem during the run. After a run completes you'll find:

```
reports/
└── workpapers/
    ├── corporate-profile.md
    ├── financial-health.md
    ├── litigation-regulatory.md
    ├── news-reputation.md
    ├── competitive-landscape.md
    ├── competitor-<slug>.md           (one per competitor — Phase 2 fan-out)
    └── rivian-due-diligence-report.md (the full ~30KB synthesized memo)
```

The orchestrator's final assistant message (saved to `sample_output_rivian.md` by the runner) is a structured executive summary. The same-named file inside `reports/workpapers/` is the long-form memo with full per-section detail, inline source URLs, and references to every workpaper.

## Adapting the agent

The pattern doesn't care about the domain. Swap the five DD tracks for whatever you actually research:

- **Newsletter prep:** topic-survey / contrarian-views / primary-sources / open-questions subagents.
- **Lead generation:** company-overview / decision-maker / recent-signals / outreach-hook subagents.
- **Comparison shopping:** product-spec / price-and-availability / review-summary / shipping subagents.
- **Market sizing:** TAM / competitor-landscape / growth-drivers / regulatory-tailwinds subagents.
- **Candidate research:** background / public-work / network / red-flags subagents.
- **Compliance / KYB:** beneficial-ownership / sanctions / litigation / PEP-screening subagents.
- **M&A target screening:** add an IP-portfolio subagent to the DD set.
- **VC sourcing:** swap financial-health for founder-and-team.

Each track is another subagent dict with a system prompt and the same `research_task` tool. The orchestrator's `write_todos` planner adapts automatically — no new infrastructure needed.

## Caveats

This agent produces a **draft** for human review, not a final memo. Web sources can be incomplete, outdated, or conflicting. Every Parallel-sourced field carries a citation and a confidence score; the orchestrator surfaces low-confidence findings explicitly. **Use them.** Treat the output as a senior analyst's prep, not as decision-grade output.

## Resources

- [Deep Agents documentation](https://docs.langchain.com/oss/python/deepagents/overview)
- [Parallel Task API](https://docs.parallel.ai/task-api/task-quickstart)
- [Parallel Basis and Citations](https://docs.parallel.ai/task-api/guides/basis)
- [Parallel Interactive Research](https://docs.parallel.ai/task-api/guides/interactions)
- [`langchain-parallel` SDK](https://github.com/parallel-web/langchain-parallel)
- [Get a Parallel API key](https://platform.parallel.ai)
