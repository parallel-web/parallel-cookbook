# Building a company due diligence agent with Deep Agents and Parallel

*Automate multi-step company research with agentic orchestration and structured web intelligence.*

**Tags:** Cookbook
**Reading time:** ~10 min
**GitHub:** [parallel-cookbook/python-recipes/parallel-deepagents-due-diligence](https://github.com/parallel-web/parallel-cookbook/tree/main/python-recipes/parallel-deepagents-due-diligence)

---

Company due diligence is a workflow that shows up everywhere in financial services. PE analysts screen deals. Bank credit teams assess borrowers. Compliance teams onboard new entities under KYB and EDD obligations. Insurance underwriters evaluate commercial policyholders. Vendor-risk teams scrutinize prospective suppliers. The research follows a consistent pattern: take a company, investigate it across several dimensions, produce a structured intelligence report where every claim has a source trail and any uncertain finding is flagged for human verification.

The accountability bar is what makes this hard to automate well. A bank's KYB file or a credit committee's deal memo is a defensible artifact — every claim eventually traces to a source, every uncertain item gets a follow-up. Most "research agent" demos handle the search-and-summarize half cleanly but treat their own confidence as opaque. They produce confident-sounding paragraphs whether the underlying source was a clean SEC filing or a stale forum post.

This cookbook builds an agent that doesn't make that trade-off. **Deep Agents is the harness**, [**Parallel** is the research substrate](https://docs.parallel.ai/task-api/task-quickstart). [Deep Agents](https://docs.langchain.com/oss/python/deepagents/overview) provides four primitives the recipe leans on — a [planning tool](https://docs.langchain.com/oss/python/deepagents/overview#planning) (`write_todos`), [subagents](https://docs.langchain.com/oss/python/deepagents/subagents) with isolated context, a [virtual filesystem](https://docs.langchain.com/oss/python/deepagents/filesystem) for offloading raw research, and middleware for control. [Parallel's Task API](https://docs.parallel.ai/task-api/task-quickstart) returns structured findings annotated with [Basis](https://docs.parallel.ai/task-api/guides/basis) — a per-field object containing source citations, the model's reasoning, and a high/medium/low confidence rating attached to each output field. And [`previous_interaction_id`](https://docs.parallel.ai/task-api/guides/interactions) lets the agent chain a follow-up query that inherits the prior research thread's source context, so "verify the field that came back at low confidence" doesn't restart cold.

We validated the recipe end-to-end on Rivian Automotive (NASDAQ: RIVN). At the default `core-fast` Task processor: **14 minutes wall-clock, 10 Task API calls, a [33KB cited memo](reports/workpapers/rivian-due-diligence-report.md) with [eight supporting workpapers](reports/workpapers/) persisted to local disk**. More on what the agent actually produced below.

## Overview

The agent orchestrates the research in three phases.

**Phase 1** dispatches five research subagents in parallel. Each has a focused system prompt and produces its own workpaper file:

- **Corporate profile** — legal entity structure, key officers, founding history, headcount, office locations
- **Financial health** — funding history, revenue signals, valuation indicators, profitability markers
- **Litigation and regulatory** — lawsuits, SEC filings, sanctions screening, regulatory actions, settlements
- **News and reputation** — recent press coverage, leadership changes, controversy flags, media sentiment
- **Competitive landscape** — identifies the top three competitors and the target's positioning (does not produce per-competitor profiles — that's Phase 2)

**Phase 2** is a [subagent fan-out](https://docs.langchain.com/oss/python/deepagents/subagents) — once `competitive-landscape` returns the named competitor list, the orchestrator dispatches **one separate `competitor-analysis` subagent instance per competitor**, in parallel. Each instance runs against its own isolated message history. The reason that matters: each `competitor-analysis` run burns through its own ~10–20K tokens of raw research material — pricing tables, product specs, recent press, financial figures — and only a distilled workpaper file ends up in the synthesis context. Without isolation, three competitors' raw findings would stack into the orchestrator's window and crowd out the cross-reference reasoning that has to happen in Phase 3.

**Phase 3** is synthesis: the orchestrator reads every workpaper from disk, cross-references for contradictions and low-confidence findings, runs ad-hoc lookups via [`ParallelWebSearchTool`](https://docs.parallel.ai/search/search-quickstart) when discrepancies surface (~1–3s and a fraction of a cent per call — much cheaper than spinning up another Task call to disambiguate one fact), and writes the final memo with risk flags and citation trails.

DD requires this multi-step architecture rather than a single API call because earlier findings change what needs to be investigated next. If `corporate-profile` reveals the target is a subsidiary, the financial analysis needs to cover the parent. If the litigation scan surfaces an SEC investigation, the risk assessment shifts. The Phase-2 fan-out matches the subagent shape Deep Agents was designed around: spawning N instances of the same subagent type for N parallel investigations, with isolated message histories per instance.

## Implementation

### Setup

```bash
uv pip install deepagents langchain-parallel langchain-anthropic
```

```bash
export ANTHROPIC_API_KEY="your-anthropic-api-key"
export PARALLEL_API_KEY="your-parallel-api-key"
```

### The research tool

The whole recipe sits on top of a roughly twenty-line wrapper around `langchain-parallel`'s `ParallelTaskRunTool` and `parse_basis` helper:

```python
from typing import Optional

from langchain_core.tools import tool
from langchain_parallel import ParallelTaskRunTool, parse_basis


@tool
def research_task(
    query: str,
    output_description: str,
    previous_interaction_id: Optional[str] = None,
) -> dict:
    """Run structured web research via Parallel's Task API.

    Returns findings with per-field citations and confidence scores (Basis).
    Use ``previous_interaction_id`` to chain a follow-up query that builds
    on a prior research session.
    """
    runner = ParallelTaskRunTool(
        processor="core-fast",
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
```

Three things happen on top of the SDK call. The wrapper routes through `ParallelTaskRunTool` for structured task execution. It calls `parse_basis(result)` to extract per-field citations and the names of any fields whose confidence came back as `"low"`. And it surfaces those field names as an explicit `low_confidence_warning` in the tool's return value, so the calling subagent's reasoning loop can see them and decide to chain a follow-up.

That last part is the load-bearing detail. The agent doesn't have to silently trust whatever Parallel returns — it can read the warning, see that `current_ceo` came back at low confidence, and chain a follow-up query that anchors to the same research thread via `previous_interaction_id`.

### Subagents

Each research track gets its own subagent dict — a name, a description, a focused system prompt, and the `research_task` tool. The Phase-1 subagents are tightly budgeted (one packed Task call plus an optional chained follow-up if Basis flags a low-confidence field) so total run cost stays bounded.

```python
corporate_profile_subagent = {
    "name": "corporate-profile",
    "description": (
        "Research corporate structure, leadership, founding history, "
        "and headcount for the target company."
    ),
    "system_prompt": """You are a corporate research analyst.

Budget: 1 research_task call, plus at most 1 chained follow-up if and
only if the first result includes a low_confidence_warning on an
important field.

Make a single research_task call requesting all of these fields in one
output_description:
- Legal entity name, incorporation jurisdiction, founding date
- Current CEO and key executives (names, titles, approximate tenure)
- Headquarters location and major office locations
- Employee headcount (current and recent trend)
- Corporate structure (parent company, major subsidiaries)

If a low_confidence_warning surfaces, chain a single follow-up using
previous_interaction_id to verify the flagged fields.

Write your findings (including citations_by_field) to corporate-profile.md.""",
    "tools": [research_task],
}
```

The same pattern repeats for `financial_health_subagent`, `litigation_subagent`, `news_reputation_subagent`, and `competitive_landscape_subagent`. The full set is in [`agent.py`](agent.py).

The Phase-2 subagent is what differentiates this recipe. Instead of asking `competitive-landscape` to produce deep per-competitor profiles, we have it identify three named competitors and let the orchestrator fan out:

```python
competitor_analysis_subagent = {
    "name": "competitor-analysis",
    "description": (
        "Produce a focused profile of one named competitor — used as a "
        "fan-out subagent invoked once per competitor identified by "
        "competitive-landscape."
    ),
    "system_prompt": """You are a competitive intelligence researcher
investigating ONE competitor company at a time.

Budget: exactly 1 research_task call.

The orchestrator will pass you a single competitor name and the original
DD target name. Make one research_task call requesting:
- Brief corporate snapshot (HQ, public/private, headcount, founding year)
- Most recent revenue and growth signals (estimated if private)
- Funding or market cap status (last raise / current cap)
- Product / positioning vs. the original DD target
- Recent strategic moves in the last 12 months
- Notable strengths and weaknesses relative to the target

Write your findings to competitor-<slug>.md, where <slug> is the
competitor's name lowercased and hyphenated.""",
    "tools": [research_task],
}
```

### The orchestrator

```python
from pathlib import Path

from deepagents import create_deep_agent
from deepagents.backends.filesystem import FilesystemBackend
from langchain_parallel import ParallelWebSearchTool

REPORTS_DIR = Path("./reports")
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

DILIGENCE_INSTRUCTIONS = """\
You are a senior due diligence analyst managing a team of specialized
researchers. Your job is to produce a comprehensive company intelligence
report where every claim has a verifiable source trail.

## Process

1. Plan: Use write_todos to lay out the diligence in three phases.

2. Phase 1 — parallel research: Use the task tool to dispatch
   corporate-profile, financial-health, litigation-regulatory,
   news-reputation, and competitive-landscape concurrently.

3. Phase 2 — competitor fan-out: After competitive-landscape completes,
   read competitive-landscape.md and parse the three named competitors.
   For EACH competitor, dispatch a separate competitor-analysis subagent
   instance via the task tool — pass the competitor's name and the
   original DD target. Dispatch all 3 in parallel.

4. Review and cross-reference: Read every workpaper file. Look for
   contradictions across tracks, low-confidence findings, and gaps. Use
   the parallel_web_search tool for ad-hoc lookups when investigating
   discrepancies.

5. Phase 3 — synthesize the report with executive summary, corporate
   profile, financial overview, litigation/regulatory risk assessment,
   news/reputation analysis, competitive landscape (with per-competitor
   sub-sections), confidence and verification notes, and key risk flags.

## Citation and Confidence Guidelines

- Include source URLs for key claims.
- Call out any finding where confidence was low — these need human
  verification.
- If two tracks produced contradictory information, note the discrepancy
  explicitly and include citations from both sources.
- This report is a draft for human review, not a final memo.
"""

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[ParallelWebSearchTool()],
    subagents=[
        corporate_profile_subagent,
        financial_health_subagent,
        litigation_subagent,
        news_reputation_subagent,
        competitive_landscape_subagent,
        competitor_analysis_subagent,
    ],
    system_prompt=DILIGENCE_INSTRUCTIONS,
    backend=FilesystemBackend(root_dir=REPORTS_DIR, virtual_mode=True),
)
```

A few details worth flagging:

[`FilesystemBackend(root_dir="./reports", virtual_mode=True)`](https://docs.langchain.com/oss/python/deepagents/filesystem) is what makes the workpapers persist to disk. Deep Agents ships with a [state-backed filesystem](https://docs.langchain.com/oss/python/deepagents/filesystem) by default, where workpapers live as agent state and evaporate when the run ends — fine for demos, less useful when you want a 33KB memo and eight workpapers you can `cat`, grep, paste into a review. **`virtual_mode=True` is critical** — with the default (`False`), an agent that picks an absolute path like `/workpapers/foo.md` will write to the actual filesystem root, *not* under `./reports/`. That's not a silent failure; it's the file ending up somewhere unexpected. Setting `virtual_mode=True` anchors the agent's virtual paths to your `root_dir`.

[`ParallelWebSearchTool()`](https://docs.parallel.ai/search/search-quickstart) is the orchestrator-only quick-lookup tool. The Search API returns LLM-optimized excerpts in 1–3 seconds at ~$0.005 per call — perfect for "is this $5.4B revenue figure for FY2024 or FY2025?" sanity passes during synthesis, where firing another Task call would be overkill.

### Running the agent

```python
result = agent.invoke({
    "messages": [{
        "role": "user",
        "content": "Conduct a full due diligence report on Rivian Automotive."
    }]
})

print(result["messages"][-1].content)
```

For long-running sessions, stream the agent's progress to see planning, subagent dispatches, and the per-competitor fan-out in real time. Pass `subgraphs=True` to surface events from inside subagent execution:

```python
for chunk in agent.stream(
    {"messages": [{"role": "user", "content": "Conduct a full due diligence report on Rivian Automotive."}]},
    stream_mode="updates",
    subgraphs=True,
    version="v2",
):
    if chunk.get("type") == "updates":
        source = f"[subagent: {chunk['ns']}]" if chunk.get("ns") else "[orchestrator]"
        print(f"{source} {chunk.get('data')}")
```

## What the agent produced

The Rivian run came back with the things you'd hope a competent junior analyst's first draft would catch — and a few that they might not. The full output is in [`reports/workpapers/`](reports/workpapers/): eight subagent workpapers and a synthesized [`rivian-due-diligence-report.md`](reports/workpapers/rivian-due-diligence-report.md).

**A structural fragility finding the financial track surfaced on its own.** The [financial-health workpaper](reports/workpapers/financial-health.md) flagged that Rivian's Q4 2025 automotive gross profit had turned negative — driven by a $270M decline in regulatory credit sales. That's the kind of finding a one-shot research summary tends to miss because it requires connecting the headline gross-profit number to the line item that produced it. From the [final memo](reports/workpapers/rivian-due-diligence-report.md):

> *Q4 2025 automotive gross profit turned negative primarily due to a $270M decline in regulatory credit sales. This volatility — driven by policy/regulatory decisions outside Rivian's control — makes near-term profitability fragile. Investors should model scenarios with and without regulatory credit income.*

**A non-obvious competitive advantage from the Phase-2 fan-out.** The [`competitor-tesla`](reports/workpapers/competitor-tesla.md) subagent pulled out a near-term price-of-purchase advantage you wouldn't get from a generic "Rivian's competitors are Tesla, Ford, GM" paragraph:

> *"R1T qualifies for IRA EV tax credits (~$7,500); Cybertruck does not — a meaningful price-of-purchase advantage for Rivian in the near term."*

The same fan-out caught Mercedes's "[technology-open](reports/workpapers/competitor-mercedes.md)" pivot — a 23% YoY decline in BEV deliveries plus an explicit slowing of EV commitment, suggesting Mercedes is becoming a less aggressive near-term competitor in the premium-SUV segment that Rivian's R1S sits in.

**A disclosure-adequacy red flag.** The [litigation-regulatory workpaper](reports/workpapers/litigation-regulatory.md) caught that a December 2024 TechCrunch investigation referred to executive harassment lawsuits as "previously unreported" — and connected the dots to a question the orchestrator carried into the final memo: *"The 'previously unreported' characterization raises a disclosure adequacy concern — reviewers should verify completeness in Rivian's SEC filings' legal proceedings section."* That's analyst-grade reasoning across what was found and what should be on file.

**Calibrated risk severity with explicit verification asks.** The [final memo](reports/workpapers/rivian-due-diligence-report.md) tiers every risk by severity (🔴 high / 🟡 medium / 🟢 resolved) and includes a "Confidence and Verification Notes" section that numbers ten specific findings with a calibrated confidence rating and the exact source-of-truth a reviewer should chase — *Crews v. Rivian* PACER docket, the 10-K balance sheet for cash-on-hand, Schedule 13D/G for the VW equity stake, the 10-K legal proceedings section for employment lawsuit completeness. Every shaky finding has a named verification path.

None of this is magic. It's what you get when the underlying research API returns calibrated confidence per field and the agent has the affordance to chain a follow-up. The architecture just makes "ask sharper questions when the first answer is shaky" a first-class behavior.

### Cost and latency

The Rivian run hit **10 Task API calls in ~14 minutes** at the default `core-fast` processor — five Phase-1 packed calls (with a couple of chained follow-ups for low-confidence fields) plus three Phase-2 competitor-analysis instances. Per-call latency varies by tier: `core-fast` is 15s–100s/call, `pro-fast` is 30s–5min/call, `ultra` is 5–25min/call. Tier up to `pro-fast` for higher-stakes diligence and `ultra` for investment-committee-grade output. See [Parallel pricing](https://docs.parallel.ai/getting-started/pricing) for current rates.

### Extensions

The five Phase-1 tracks are a starting point — each new domain is a new subagent dict with a focused prompt and the same `research_task` tool. A few natural extensions on the Parallel side:

- Swap `competitive-landscape` for [**FindAll**](https://docs.parallel.ai/findall-api/findall-quickstart) when the diligence task is "find every subsidiary that satisfies condition X" or "find every vendor in category Y," not just "name three competitors." FindAll is purpose-built for evaluated entity discovery — exactly the shape of beneficial-ownership tracing in KYB or supplier-mapping in vendor risk.
- Plug the final memo into [**Monitor**](https://docs.parallel.ai/monitor-api/monitor-quickstart) for ongoing post-deal surveillance — a credit-team's syndicate refresh, a portfolio-company quarterly health check, or a vendor's ongoing risk file.
- Run the recipe at portfolio scale with [**`ParallelEnrichment`**](https://docs.parallel.ai/task-api/group-api) — DD-lite across fifty deal-screening targets in one batch instead of fifty one-shot agent runs.
- Tier up to the `ultra` Task processor when you need [Deep Research](https://docs.parallel.ai/task-api/examples/task-deep-research)–grade reasoning per subagent, e.g. for IC-grade investment memos.

Deep Agents itself has primitives we don't exercise here that are worth knowing about as you adapt the recipe — [`interrupt_on`](https://docs.langchain.com/oss/python/deepagents/overview) for human-in-the-loop sign-off before the synthesis pass (analyst approval gates), [`checkpointer`](https://docs.langchain.com/oss/python/deepagents/overview) so a 14-minute run can resume from a crash, and [skills / memory](https://docs.langchain.com/oss/python/deepagents/overview) for cross-run learning of preferred sources and verification heuristics.

## Run it yourself

```bash
git clone https://github.com/parallel-web/parallel-cookbook
cd parallel-cookbook/python-recipes/parallel-deepagents-due-diligence

uv venv
uv pip install -e .
cp .env.example .env  # then fill in ANTHROPIC_API_KEY + PARALLEL_API_KEY

uv run python agent.py
```

The recipe ships with the full Rivian sample run committed under [`reports/workpapers/`](reports/workpapers/) — start with the [synthesized memo](reports/workpapers/rivian-due-diligence-report.md) and the [Tesla competitor workpaper](reports/workpapers/competitor-tesla.md) for a sense of the artifact shape before committing your own keys.

## Resources

- [Full source code](https://github.com/parallel-web/parallel-cookbook/tree/main/python-recipes/parallel-deepagents-due-diligence) and [sample Rivian run](reports/workpapers/) on GitHub
- [Deep Agents documentation](https://docs.langchain.com/oss/python/deepagents/overview) — the harness
- [Parallel Task API](https://docs.parallel.ai/task-api/task-quickstart), [Basis](https://docs.parallel.ai/task-api/guides/basis), and [interactive research](https://docs.parallel.ai/task-api/guides/interactions) — the research substrate
- [`langchain-parallel` SDK](https://github.com/parallel-web/langchain-parallel) and [Parallel API keys](https://platform.parallel.ai)
