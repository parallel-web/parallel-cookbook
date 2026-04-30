# Building a company due diligence agent with Deep Agents and Parallel

*Automate multi-step company research with agentic orchestration and structured web intelligence.*

- **Tags:** Cookbook
- **GitHub:** [parallel-cookbook/python-recipes/parallel-deepagents-due-diligence](https://github.com/parallel-web/parallel-cookbook/tree/main/python-recipes/parallel-deepagents-due-diligence)
- **Sample output:** [Rivian DD memo](reports/workpapers/rivian-due-diligence-report.md) and [eight workpapers](reports/workpapers/)

---

Company due diligence is a workflow that shows up everywhere in financial services. PE analysts screen deals, bank credit teams assess borrowers, compliance teams onboard new entities, insurance underwriters evaluate commercial policyholders. The research follows a consistent pattern. Take a company, investigate it across several dimensions, produce a structured intelligence report where every claim has a source trail.

This cookbook builds an agent that automates that workflow by combining LangChain's [Deep Agents](https://docs.langchain.com/oss/python/deepagents/overview) for orchestration and [Parallel's Task API](https://docs.parallel.ai/task-api/task-quickstart) for web research. Deep Agents handles planning, subagent delegation, and context management. Parallel handles the actual research, returning structured findings with per-field citations, reasoning traces, and calibrated confidence scores via [Basis](https://docs.parallel.ai/task-api/guides/access-research-basis). When findings from one track raise new questions, Parallel's [interactive research](https://docs.parallel.ai/task-api/guides/interactions) feature lets the agent chain follow-up queries with full context from the prior research thread.

## Overview

The agent orchestrates five research tracks, each handled by a dedicated subagent:

- **Corporate profile** — legal entity structure, key officers, founding history, headcount, office locations
- **Financial health** — funding history, revenue signals, valuation indicators, profitability markers
- **Litigation and regulatory** — lawsuits, SEC filings, sanctions screening, regulatory actions, settlements
- **News and reputation** — recent press coverage, leadership changes, controversy flags, media sentiment
- **Competitive landscape** — identifies the top three direct competitors and the target's positioning

Once `competitive-landscape` returns its named list, the orchestrator dispatches a separate `competitor-analysis` subagent **once per competitor**, in parallel — the canonical Deep Agents fan-out shape, with each instance running in its own isolated context. The orchestrator then reads every workpaper, cross-references for contradictions and low-confidence findings, runs ad-hoc lookups via Parallel's Search API when discrepancies surface, and writes the final report with risk flags and citation trails.

DD requires this multi-step architecture because earlier findings change what needs to be investigated next. If the corporate profile reveals the target is a subsidiary, the financial analysis needs to cover the parent. If the litigation scan surfaces an SEC investigation, the risk assessment changes. Deep Agents' planning tool lets the orchestrator adapt when findings shift the research plan.

Each research track uses a `pro-fast` processor Task API call. Validated end-to-end on Rivian Automotive (NASDAQ: RIVN): nine calls in ~23 minutes. See [Parallel pricing](https://docs.parallel.ai/getting-started/pricing) for current rates.

## Implementation

### Setup

```bash
uv pip install deepagents langchain-parallel langchain-anthropic
```

```bash
export ANTHROPIC_API_KEY="your-anthropic-api-key"
export PARALLEL_API_KEY="your-parallel-api-key"
```

### Defining the Parallel research tools

We define two tools. The first wraps Parallel's Task API for structured research with Basis-aware confidence handling. The second uses the LangChain integration's web search tool for quick factual lookups during synthesis.

```python
from typing import Optional

from langchain_core.tools import tool
from langchain_parallel import (
    ParallelTaskRunTool,
    ParallelWebSearchTool,
    parse_basis,
)


@tool
def research_task(
    query: str,
    output_description: str,
    previous_interaction_id: Optional[str] = None,
) -> dict:
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
            "These fields came back with low confidence and should be "
            "verified, ideally by chaining a follow-up query with "
            "previous_interaction_id: "
            + ", ".join(parsed["low_confidence_fields"])
        )
    return response


# Quick search tool for fast factual lookups during synthesis
quick_search = ParallelWebSearchTool()
```

The tool does three things beyond a raw API call. It calls `parse_basis(result)` to extract per-field citations and the names of any low-confidence fields. It surfaces those names as an explicit `low_confidence_warning` in the tool's return value, so the calling subagent's reasoning loop can decide to chain a follow-up. And it returns the `interaction_id` so the chained call can anchor to the same research thread via `previous_interaction_id`.

### Defining the research subagents

Each research track gets its own subagent with a specialized system prompt and access to the `research_task` tool.

```python
corporate_profile_subagent = {
    "name": "corporate-profile",
    "description": "Research corporate structure, leadership, founding history, and headcount",
    "system_prompt": """You are a corporate research analyst.

Given a company, use the research_task tool to find:
- Legal entity name, incorporation state/country, founding date
- Current CEO and key executives (names, titles, approximate tenure)
- Headquarters location and major office locations
- Employee headcount (current and recent trend)
- Corporate structure (parent company, major subsidiaries)

For the output_description parameter, request these as structured fields.

If the result includes a low_confidence_warning, chain a follow-up query
using the returned interaction_id to verify the flagged fields.

Write your findings (including citations_by_field) to corporate-profile.md.""",
    "tools": [research_task],
}
```

The other Phase-1 subagents (`financial-health`, `litigation-regulatory`, `news-reputation`, `competitive-landscape`) follow the same shape with their own focused prompts. The full set is in [`agent.py`](agent.py).

The Phase-2 fan-out subagent is invoked once per competitor identified by `competitive-landscape`:

```python
competitor_analysis_subagent = {
    "name": "competitor-analysis",
    "description": "Produce a focused profile of one named competitor",
    "system_prompt": """You are a competitive intelligence researcher.

The orchestrator will pass you a single competitor name and the original
DD target. Make one research_task call requesting:
- Corporate snapshot (HQ, public/private, headcount, founding year)
- Most recent revenue and growth signals
- Funding or market cap status
- Product / positioning vs. the original DD target
- Recent strategic moves in the last 12 months
- Notable strengths and weaknesses relative to the target

Write your findings to competitor-<slug>.md.""",
    "tools": [research_task],
}
```

### Creating the orchestrator agent

The main agent coordinates the subagents, reviews findings for contradictions, and produces the final report. We back it with a [`FilesystemBackend`](https://docs.langchain.com/oss/python/deepagents/filesystem) so workpapers and the final memo persist to disk under `./reports/` rather than evaporating with the agent state.

```python
from pathlib import Path

from deepagents import create_deep_agent
from deepagents.backends.filesystem import FilesystemBackend

REPORTS_DIR = Path("./reports")
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

diligence_instructions = """\
You are a senior due diligence analyst managing a team of specialized
researchers. Your job is to produce a comprehensive company intelligence
report with verifiable claims.

## Your Process

1. **Plan the research**: Use write_todos to lay out the diligence as a
   checklist. Phase 1 dispatches the five Phase-1 subagents. Phase 2
   dispatches one competitor-analysis subagent per competitor identified
   by competitive-landscape.

2. **Phase 1 — parallel research**: Use the task tool to dispatch
   corporate-profile, financial-health, litigation-regulatory,
   news-reputation, and competitive-landscape concurrently.

3. **Phase 2 — competitor fan-out**: Read competitive-landscape.md and
   parse the three named competitors. Dispatch a separate
   competitor-analysis subagent instance per competitor, in parallel.

4. **Review and cross-reference**: Read every workpaper. Look for
   contradictions, low-confidence findings, and gaps. Use quick_search
   for ad-hoc lookups during synthesis.

5. **Synthesize the report** with: executive summary, corporate profile,
   financial overview, litigation and regulatory risk assessment, news
   and reputation analysis, competitive landscape (with per-competitor
   sub-sections), confidence and verification notes, and key risk flags.

## Citation and Confidence Guidelines

- Include source URLs for key claims.
- Call out any finding where confidence was low. These need human verification.
- If two tracks produced contradictory information, note the discrepancy
  explicitly with citations from both sources.
"""

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[quick_search],
    subagents=[
        corporate_profile_subagent,
        financial_health_subagent,
        litigation_subagent,
        news_reputation_subagent,
        competitive_landscape_subagent,
        competitor_analysis_subagent,
    ],
    system_prompt=diligence_instructions,
    backend=FilesystemBackend(root_dir=REPORTS_DIR, virtual_mode=True),
)
```

### Running the agent

```python
result = agent.invoke({
    "messages": [{
        "role": "user",
        "content": "Conduct a full due diligence report on Rivian Automotive",
    }]
})

print(result["messages"][-1].content)
```

### Streaming execution progress

For long-running diligence runs, stream the agent's progress to see planning, tool calls, and subagent activity in real time. Pass `subgraphs=True` to receive events from inside subagent execution.

```python
for chunk in agent.stream(
    {"messages": [{"role": "user", "content": "Conduct a full due diligence report on Rivian Automotive"}]},
    stream_mode="updates",
    subgraphs=True,
    version="v2",
):
    if chunk.get("type") == "updates":
        source = f"[subagent: {chunk['ns']}]" if chunk.get("ns") else "[orchestrator]"
        print(f"{source} {chunk.get('data')}")
```

## Who this is for

This architecture applies to any team running structured research workflows on companies, including deal screening, credit underwriting, KYB/KYC onboarding, M&A target evaluation, and vendor risk assessment.

The five research tracks here are a starting point. Swap in tracks relevant to your workflow: add management background checks and beneficial ownership tracing for compliance-heavy diligence, add IP portfolio analysis for M&A screening, add SOC 2 verification for vendor assessment. Each additional track is a new subagent dict with a system prompt and the same `research_task` tool.

## Resources

- [Full source code](https://github.com/parallel-web/parallel-cookbook/tree/main/python-recipes/parallel-deepagents-due-diligence)
- [Deep Agents documentation](https://docs.langchain.com/oss/python/deepagents/overview)
- [Parallel Task API](https://docs.parallel.ai/task-api/task-quickstart)
- [Parallel Basis and citations](https://docs.parallel.ai/task-api/guides/access-research-basis)
- [Parallel interactive research](https://docs.parallel.ai/task-api/guides/interactions)
- [`langchain-parallel` SDK](https://github.com/parallel-web/langchain-parallel)
- [Get a Parallel API key](https://platform.parallel.ai)
