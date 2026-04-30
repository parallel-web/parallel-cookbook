"""Company due diligence agent built on Deep Agents and Parallel.

The orchestrator plans the diligence as a TODO list, dispatches five research
subagents to work in parallel, reviews each subagent's findings (including
explicit low-confidence warnings surfaced by Parallel's Basis), runs targeted
follow-up queries when needed, and synthesizes a citation-grade DD memo.

Run:
    export ANTHROPIC_API_KEY="..."
    export PARALLEL_API_KEY="..."
    uv run python agent.py
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from deepagents import create_deep_agent
from deepagents.backends.filesystem import FilesystemBackend
from langchain_core.tools import tool
from langchain_parallel import (
    ParallelTaskRunTool,
    ParallelWebSearchTool,
    parse_basis,
)


# Default target company for the example run. Override by passing a different
# name to ``run(target)`` / ``stream(target)`` or via the CLI.
TARGET_COMPANY = "Rivian Automotive"

# Where the agent writes per-subagent workpapers and the final memo. The
# orchestrator and subagents call write_file / read_file against this root.
# Defaults to ./reports/ relative to this file.
REPORTS_DIR = Path(__file__).parent / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@tool
def research_task(
    query: str,
    output_description: str,
    previous_interaction_id: Optional[str] = None,
) -> dict:
    """Run structured web research via Parallel's Task API.

    Returns findings with per-field citations and confidence scores (Basis).
    Use ``previous_interaction_id`` to chain a follow-up query that builds on
    a prior research session — useful when an earlier result surfaces a
    ``low_confidence_warning`` and you want to dig deeper on flagged fields.

    Args:
        query: The research question or company name.
        output_description: A natural-language description of the structured
            information you want returned. Be specific — list fields.
        previous_interaction_id: Chain onto a previous research session.
            Pass the ``interaction_id`` from a prior ``research_task`` result.

    Returns:
        Dict with:
        - ``findings``: structured output content from the Task API.
        - ``citations_by_field``: per-field source citations.
        - ``interaction_id``: chain this into a follow-up via
          ``previous_interaction_id``.
        - ``low_confidence_warning`` (optional): present only when one or
          more fields came back at confidence == "low". The agent should
          consider chaining a follow-up to verify those specific fields.
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


quick_search = ParallelWebSearchTool()


# ---------------------------------------------------------------------------
# Subagents
# ---------------------------------------------------------------------------


corporate_profile_subagent = {
    "name": "corporate-profile",
    "description": (
        "Research corporate structure, leadership, founding history, "
        "and headcount for the target company."
    ),
    "system_prompt": """You are a corporate research analyst.

**Budget: 1 research_task call, plus at most 1 chained follow-up if and
only if the first result included a low_confidence_warning on an
important field.** Do not make additional discretionary queries.

Make a single research_task call requesting all of these fields in one
output_description:
- Legal entity name, incorporation jurisdiction, founding date
- Current CEO and key executives (names, titles, approximate tenure)
- Headquarters location and major office locations
- Employee headcount (current and recent trend)
- Corporate structure (parent company, major subsidiaries)

If a low_confidence_warning surfaces, optionally chain a single follow-up
using previous_interaction_id to verify the flagged fields.

Write your findings (including citations_by_field) to corporate-profile.md.""",
    "tools": [research_task],
}

financial_health_subagent = {
    "name": "financial-health",
    "description": (
        "Research funding history, revenue signals, and financial indicators "
        "for the target company."
    ),
    "system_prompt": """You are a financial research analyst.

**Budget: 1 research_task call, plus at most 1 chained follow-up if and
only if a critical financial field comes back at low confidence.** Do
not make additional discretionary queries.

Make a single research_task call requesting all of these fields:
- Funding history (rounds, amounts, lead investors, dates)
- Revenue estimates or reported revenue figures
- Valuation indicators (last known valuation, public market cap if applicable)
- Profitability signals (profitable, pre-revenue, burn rate indicators)
- Key financial partnerships or banking relationships

For private companies, clearly distinguish estimates from confirmed figures.

If the low_confidence_warning flags a critical financial field (revenue,
funding, profitability), optionally chain one follow-up using the
interaction_id.

Write findings and citations to financial-health.md.""",
    "tools": [research_task],
}

litigation_subagent = {
    "name": "litigation-regulatory",
    "description": (
        "Research lawsuits, regulatory actions, SEC filings, and sanctions "
        "exposure for the target company."
    ),
    "system_prompt": """You are a legal and compliance research analyst.

**Budget: 1 research_task call, plus at most 1 chained follow-up if a
significant litigation item warrants deeper investigation.** Do not make
additional discretionary queries.

Make a single research_task call requesting all of these fields:
- Active or recent lawsuits (as plaintiff or defendant)
- SEC filings, enforcement actions, or investigations
- Regulatory actions from any government body
- Sanctions screening results (OFAC, EU, UN sanctions lists)
- History of fines, consent decrees, or settlements

Flag anything that would require escalation in a standard KYC/EDD review.
If a significant litigation item surfaces (active securities class action,
regulatory enforcement action, sanctions designation), optionally chain
one follow-up using interaction_id for more detail on that specific item.

Write findings and citations to litigation-regulatory.md.""",
    "tools": [research_task],
}

news_reputation_subagent = {
    "name": "news-reputation",
    "description": (
        "Research recent press coverage, sentiment, and controversy flags "
        "for the target company."
    ),
    "system_prompt": """You are a media intelligence analyst.

**Budget: 1 research_task call. No follow-ups unless explicitly required
for a verifiable controversy.** Do not make additional discretionary
queries.

Make a single research_task call requesting all of these fields:
- Major press coverage from the last 12 months
- Leadership changes or executive departures
- Product launches, pivots, or strategic shifts
- Controversy, scandal, or negative press patterns
- Overall media sentiment (positive, neutral, negative)

Distinguish between isolated incidents and patterns.

Write findings and citations to news-reputation.md.""",
    "tools": [research_task],
}

competitive_landscape_subagent = {
    "name": "competitive-landscape",
    "description": (
        "Identify the target's top 3-5 direct competitors and the company's "
        "market positioning. Returns a competitor list that the orchestrator "
        "fans out for per-competitor investigation."
    ),
    "system_prompt": """You are a market intelligence analyst.

**Budget: exactly 1 research_task call. No follow-ups, no additional
queries.** Your only job here is to identify the named competitors and
the target's positioning — the orchestrator will fan out per-competitor
analysis separately.

Make a single research_task call requesting these fields:
- Top 3 direct competitors of the target (exactly 3, named, with one-line context each)
- Target's market positioning and key differentiators
- Industry-wide market-share or ranking signals
- One-paragraph industry analyst summary of the target's competitive standing

You are NOT responsible for deep per-competitor profiles — the orchestrator
will fan out a separate competitor-analysis subagent for each of the 3
competitors you identify.

Write findings to competitive-landscape.md. Make sure the file contains a
clearly-labeled "## Competitors" section with EXACTLY 3 named bullets so
the orchestrator can parse them.""",
    "tools": [research_task],
}

competitor_analysis_subagent = {
    "name": "competitor-analysis",
    "description": (
        "Produce a focused profile of one named competitor — used as a "
        "fan-out subagent invoked once per competitor identified by "
        "competitive-landscape."
    ),
    "system_prompt": """You are a competitive intelligence researcher
investigating ONE competitor company at a time.

**Budget: exactly 1 research_task call. No follow-ups, no additional
queries.** Pack everything you need into one well-scoped output_description.

The orchestrator will pass you a single competitor name and the original
DD target name. Make ONE research_task call requesting all of:
- Brief corporate snapshot (HQ, public/private, headcount, founding year)
- Most recent revenue and growth signals (estimated if private)
- Funding or market cap status (last raise / current cap)
- Product / positioning vs. the original DD target (one paragraph)
- Recent strategic moves in the last 12 months
- Notable strengths and weaknesses relative to the target

Write your findings to a file named competitor-<slug>.md, where <slug>
is the competitor's name lowercased and hyphenated (e.g.
"competitor-tesla.md", "competitor-ford-motor.md"). One file per
competitor — the orchestrator will read all of them when synthesizing
the comparative section.""",
    "tools": [research_task],
}


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


DILIGENCE_INSTRUCTIONS = """\
You are a senior due diligence analyst managing a team of specialized
researchers. Your job is to produce a comprehensive company intelligence
report where every claim has a verifiable source trail.

## Process

1. **Plan**: Use write_todos to lay out the diligence. Phase 1 dispatches
   five subagents in parallel. Phase 2 fans out per-competitor analysis.
   Phase 3 synthesizes the final memo.

2. **Phase 1 — parallel research**: Use the task tool to dispatch
   corporate-profile, financial-health, litigation-regulatory,
   news-reputation, and competitive-landscape concurrently. Pass the
   target company name to each.

3. **Phase 2 — competitor fan-out**: After competitive-landscape completes,
   read competitive-landscape.md and parse the **exactly 3** named
   competitors. For EACH of the 3 competitors, dispatch a separate
   competitor-analysis subagent instance via the task tool — pass the
   competitor's name and the original DD target name. Dispatch all 3 in
   parallel; each investigation runs in its own isolated context. Each
   competitor subagent writes its findings to its own
   competitor-<slug>.md file. **Do not dispatch competitor-analysis for
   any competitor not on the list — exactly 3 instances total.**

4. **Review and cross-reference**: Read every workpaper file
   (corporate-profile.md, financial-health.md, litigation-regulatory.md,
   news-reputation.md, competitive-landscape.md, and every
   competitor-<slug>.md). Look for:
   - Contradictions across tracks (funding info conflicts with corporate
     structure, news contradicts official statements).
   - Low-confidence findings flagged by the research tool.
   - Gaps where information was unavailable.
   Use the parallel_web_search tool for ad-hoc lookups when investigating
   discrepancies.

5. **Phase 3 — synthesize the report** with these sections:
   - Executive summary (2-3 paragraphs with overall risk assessment).
   - Corporate profile.
   - Financial overview.
   - Litigation and regulatory risk assessment.
   - News and reputation analysis.
   - Competitive landscape — start with the target's positioning, then
     include a per-competitor sub-section (one paragraph each) drawing
     from each competitor-<slug>.md workpaper. Compare each competitor's
     strengths and weaknesses to the target.
   - Confidence and verification notes (list any medium/low confidence
     findings and their source citations so a reviewer can verify).
   - Key risk flags and areas requiring further investigation.

## Citation and confidence guidelines

- Include source URLs from the citations data for key claims.
- Call out any finding where confidence was low. These need human verification.
- If two tracks produced contradictory information, note the discrepancy
  explicitly and include citations from both sources.
- This report is a draft for human review, not a final memo.
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
    system_prompt=DILIGENCE_INSTRUCTIONS,
    backend=FilesystemBackend(root_dir=REPORTS_DIR, virtual_mode=True),
)


# ---------------------------------------------------------------------------
# Convenience runner
# ---------------------------------------------------------------------------


def run(target: str = TARGET_COMPANY) -> str:
    """Run a full DD report on the target company. Returns the final memo."""
    result = agent.invoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": f"Conduct a full due diligence report on {target}.",
                }
            ]
        }
    )
    return result["messages"][-1].content


def stream(target: str = TARGET_COMPANY) -> None:
    """Stream the agent's progress to stdout. Useful for long-running runs."""
    for chunk in agent.stream(
        {
            "messages": [
                {
                    "role": "user",
                    "content": f"Conduct a full due diligence report on {target}.",
                }
            ]
        },
        stream_mode="updates",
        subgraphs=True,
        version="v2",
    ):
        if chunk.get("type") == "updates":
            source = (
                f"[subagent: {chunk['ns']}]" if chunk.get("ns") else "[orchestrator]"
            )
            print(f"{source} {chunk.get('data')}")


if __name__ == "__main__":
    import sys

    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_COMPANY
    print(run(target))
