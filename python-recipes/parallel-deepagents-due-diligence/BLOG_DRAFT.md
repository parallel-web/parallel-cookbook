# Building a company due diligence agent with Deep Agents and Parallel

*Automate multi-step company research with agentic orchestration and structured web intelligence.*

**Tags:** Cookbook
**Reading time:** ~10 min
**GitHub:** [parallel-cookbook/python-recipes/parallel-deepagents-due-diligence](https://github.com/parallel-web/parallel-cookbook/tree/main/python-recipes/parallel-deepagents-due-diligence)

---

Company due diligence is a workflow that shows up everywhere in financial services. PE analysts screen deals. Bank credit teams assess borrowers. Compliance teams onboard new entities under KYB and EDD obligations. Insurance underwriters evaluate commercial policyholders. Vendor-risk teams scrutinize prospective suppliers. The research follows a consistent pattern: take a company, investigate it across several dimensions, produce a structured intelligence report where every claim has a source trail and any uncertain finding is flagged for human verification.

The accountability bar is what makes this hard to automate well. A bank's KYB file or a credit committee's deal memo is a defensible artifact — every claim eventually traces to a source, every uncertain item gets a follow-up. Most "research agent" demos handle the search-and-summarize half cleanly but treat their own confidence as opaque. They produce confident-sounding paragraphs whether the underlying source was a clean SEC filing or a stale forum post.

This cookbook builds an agent that doesn't make that trade-off. It combines [**Deep Agents**](https://github.com/langchain-ai/deepagents) for orchestration and [**Parallel's Task API**](https://docs.parallel.ai/task-api/task-quickstart) for the underlying research. Deep Agents handles the planning, subagent delegation, and context management. Parallel handles the actual research, returning structured findings with per-field citations, reasoning traces, and calibrated confidence scores via [Basis](https://docs.parallel.ai/task-api/guides/basis). When findings from one track raise new questions, Parallel's [interactive research](https://docs.parallel.ai/task-api/guides/interactions) feature (`previous_interaction_id`) lets the agent chain follow-up queries with full context from the prior research thread.

We validated the recipe end-to-end on Rivian Automotive (NASDAQ: RIVN). At the default `core-fast` Task processor: **14 minutes wall-clock, 10 Task API calls, a 33KB cited memo with eight supporting workpapers persisted to local disk**. More on what the agent actually produced below.

## Overview

The agent orchestrates the research in three phases.

**Phase 1** dispatches five research subagents in parallel. Each has a focused system prompt and produces its own workpaper file:

- **Corporate profile** — legal entity structure, key officers, founding history, headcount, office locations
- **Financial health** — funding history, revenue signals, valuation indicators, profitability markers
- **Litigation and regulatory** — lawsuits, SEC filings, sanctions screening, regulatory actions, settlements
- **News and reputation** — recent press coverage, leadership changes, controversy flags, media sentiment
- **Competitive landscape** — identifies the top three competitors and the target's positioning (does not produce per-competitor profiles — that's Phase 2)

**Phase 2** is a fan-out: once `competitive-landscape` returns the named competitor list, the orchestrator dispatches **one separate `competitor-analysis` subagent instance per competitor**, in parallel. Each instance runs in its own isolated context, produces a focused profile, and writes to its own `competitor-<slug>.md` workpaper.

**Phase 3** is synthesis: the orchestrator reads every workpaper from disk, cross-references for contradictions and low-confidence findings, runs ad-hoc lookups via Parallel's Search API when discrepancies surface, and writes the final memo with risk flags and citation trails.

DD requires this multi-step architecture rather than a single API call because earlier findings change what needs to be investigated next. If `corporate-profile` reveals the target is a subsidiary, the financial analysis needs to cover the parent. If the litigation scan surfaces an SEC investigation, the risk assessment shifts. The Phase-2 fan-out is the canonical Deep Agents pattern: spawning N instances of the same subagent type for N parallel investigations, with isolated context per instance so the orchestrator's window stays clean for the synthesis pass.

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

The `FilesystemBackend(root_dir="./reports", virtual_mode=True)` is what makes the workpapers persist to disk. Deep Agents has a virtual filesystem by default — workpapers exist as state inside the agent run, then evaporate when the run ends. That's fine for ephemeral demos but unhelpful when you want a 33KB memo with eight supporting workpapers you can `cat`, search, or paste into a code review. The `virtual_mode=True` flag is critical: with the default (`False`), absolute paths the agent picks bypass `root_dir` and silently fail.

`ParallelWebSearchTool()` is the orchestrator's quick-lookup tool, used during synthesis when contradictions across workpapers need a fast sanity check.

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

For long-running sessions, stream the agent's progress to see planning, subagent dispatches, and the per-competitor fan-out in real time. Pass `subgraphs=True` to receive events from inside subagent execution:

```python
for chunk in agent.stream(
    {
        "messages": [{
            "role": "user",
            "content": "Conduct a full due diligence report on Rivian Automotive."
        }]
    },
    stream_mode="updates",
    subgraphs=True,
):
    if isinstance(chunk, tuple) and len(chunk) == 2:
        ns, update = chunk
        src = f"[subagent: {'.'.join(str(n) for n in ns)}]" if ns else "[orchestrator]"
        print(f"{src} {update}")
```

## What the agent produced

The Rivian run came back with the things you'd hope a competent junior analyst's first draft would catch — and a few that you'd hope they'd catch but might not.

**A funding-figure cross-reference resolution.** The financial-health workpaper initially had Rivian's total raised at ~$3.7B. The corporate-profile workpaper had figures that pointed higher. The orchestrator caught the discrepancy during synthesis and corrected the final memo:

> *"One research track reported ~$3.7B total raised — this figure reflected pre-Series F data; the confirmed total through Series G is ~$6.3B."*

**A specific JV-conflict finding.** The Phase-2 fan-out for VW (the Scout Motors angle) surfaced something a generic "list of competitors" paragraph wouldn't have:

> *"VW/Scout conflict of interest — no public non-compete provisions identified in JV disclosures; intensifies post-2027 when Scout launches an explicit ~$20K undercutter of R1T."*

**A material correction the synthesis flagged.** Phase-1 financial-health initially under-weighted Rivian's $6.6B DOE ATVM loan. The orchestrator flagged it during cross-reference and the final memo reads: *"DOE ATVM loan — $6.57B finalized early 2026 — underweighted in base workpaper, flagged as material correction."*

**Calibrated risk severity.** The litigation-regulatory section ranks each finding by severity tier (red/orange/green) with explicit verification asks at the bottom — Crews v. Rivian securities settlement (preliminary approval; final hearing May 15, 2026), Tesla trade-secret case (PACER verification needed), Bosch breach-of-contract dispute, NHTSA recall pattern.

None of this is magic. It's what you get when an agent has access to per-field confidence and the affordance to chain a follow-up. The architecture just makes "ask sharper questions when the first answer is shaky" a first-class behavior.

## Cost and latency

A typical run produces 8–12 Task API calls — five Phase-1 subagents (one packed call each plus a few chained follow-ups) plus three Phase-2 competitor-analysis instances. The Rivian validation run hit 10 calls in 14:36 wall-clock at the default `core-fast` processor.

| Tier | Per-run estimate | When to use |
|---|---|---|
| `core-fast` per subagent (default) | ~$0.75–1.50, ~15–25 min | Standard DD draft — agent-loop friendly latency |
| `core` per subagent | ~$1–2, ~25–40 min | Deeper non-`-fast` variant of `core` |
| Tier-up to `pro-fast` | ~$3–6, ~25–45 min | Higher-stakes DD with richer reasoning per track |
| Tier-up to `ultra` | ~$30–80, 90–180 min | Investment-committee-grade output |

See [Parallel pricing](https://docs.parallel.ai/getting-started/pricing) for current rates.

## Who this is for

This architecture applies directly to any team running structured research workflows on companies:

- **Bank credit and lending** — borrower diligence, ongoing monitoring, syndicate participation reviews
- **KYB / KYC / EDD onboarding** — enhanced diligence files for higher-risk customers, periodic refresh
- **Insurance underwriting** — commercial policyholder evaluation, reinsurance treaty diligence
- **PE / VC / corporate development** — deal screening, target evaluation, post-investment monitoring
- **Vendor and supplier risk** — third-party risk assessment files, ongoing supplier monitoring
- **Compliance and AML** — sanctions screening, beneficial ownership tracing, adverse media review

The five Phase-1 tracks here are a starting point. Swap in tracks relevant to your workflow: add a beneficial ownership tracing subagent for compliance-heavy diligence, an IP portfolio analysis subagent for M&A screening, a SOC 2 verification subagent for vendor assessment, a payments-rail and counterparty network subagent for sanctions screening. Each additional track is a new subagent dict with a system prompt and the same `research_task` tool — the underlying architecture (Phase 1 parallel subagents → Phase 2 fan-out → Phase 3 synthesis, with `parse_basis` + `previous_interaction_id` doing the confidence-aware lifting) stays identical.

## Run it yourself

```bash
git clone https://github.com/parallel-web/parallel-cookbook
cd parallel-cookbook/python-recipes/parallel-deepagents-due-diligence

uv venv
uv pip install -e .
cp .env.example .env  # then fill in ANTHROPIC_API_KEY + PARALLEL_API_KEY

uv run python agent.py
```

The recipe ships with the full Rivian sample run committed under [`reports/workpapers/`](reports/workpapers/) so you can preview the artifact shape before committing your own keys.

## Resources

- [Full source code](https://github.com/parallel-web/parallel-cookbook/tree/main/python-recipes/parallel-deepagents-due-diligence)
- [Deep Agents documentation](https://docs.langchain.com/oss/python/deepagents/overview)
- [Parallel Task API](https://docs.parallel.ai/task-api/task-quickstart)
- [Parallel Basis and citations](https://docs.parallel.ai/task-api/guides/basis)
- [Parallel interactive research](https://docs.parallel.ai/task-api/guides/interactions)
- [`langchain-parallel` SDK](https://github.com/parallel-web/langchain-parallel)
- [Get a Parallel API key](https://platform.parallel.ai)
