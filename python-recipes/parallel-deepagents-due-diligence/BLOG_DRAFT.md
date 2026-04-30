# Building a due diligence agent that reasons about its own uncertainty

*A multi-agent research recipe on LangChain's Deep Agents and Parallel's Task API. Code: [parallel-cookbook/python-recipes/parallel-deepagents-due-diligence](https://github.com/parallel-web/parallel-cookbook/tree/main/python-recipes/parallel-deepagents-due-diligence).*

---

Most research agents have a tell. They search, they take what comes back, they synthesize a confident-sounding answer — and they're equally confident whether the underlying source was a clean SEC filing or a stale forum post. The agent doesn't know what it doesn't know.

That's a real problem if you're using these agents for anything that touches accountability — KYB onboarding at a bank, vendor risk at an insurer, deal screening at a PE firm. A fabricated number in a memo is a lawsuit. The standard fix has been "always have a human verify everything," which makes the agent useful as a typing-speed assistant and not much more.

This post walks through a different shape: **a research agent that examines the confidence of its own findings and chains follow-up queries when a result is uncertain**. The recipe combines LangChain's [Deep Agents](https://github.com/langchain-ai/deepagents) harness for orchestration with [Parallel's Task API](https://docs.parallel.ai/task-api/task-quickstart) for the underlying research — specifically, Parallel's **Basis** (per-field citations + calibrated confidence scores) and **`previous_interaction_id`** (chained follow-up queries that build on prior research context).

The worked example is **company due diligence**: take a target company name, investigate it across five dimensions, produce a structured memo where every claim has a source trail and any low-confidence finding is flagged for human verification. Validated end-to-end on Rivian Automotive: 14 minutes wall-clock, 10 Task API calls, a 33KB cited memo plus eight supporting workpapers persisted to disk.

## The tool that does the actual work

The whole recipe sits on top of a roughly twenty-line wrapper around `langchain-parallel`'s `ParallelTaskRunTool` and `parse_basis` helper:

```python
from langchain_core.tools import tool
from langchain_parallel import ParallelTaskRunTool, parse_basis

@tool
def research_task(
    query: str,
    output_description: str,
    previous_interaction_id: str | None = None,
) -> dict:
    """Run structured web research via Parallel's Task API."""
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
            "These fields came back with low confidence and should be verified, "
            "ideally by chaining a follow-up query with previous_interaction_id: "
            + ", ".join(parsed["low_confidence_fields"])
        )
    return response
```

Three small things happen on top of the SDK call:

1. We route through `ParallelTaskRunTool` for structured task execution.
2. We call `parse_basis(result)` — a helper in `langchain-parallel` that walks the Task API result and pulls out per-field citations plus the names of any fields whose confidence came back as `"low"`.
3. We surface those low-confidence field names as a warning in the tool's return value, so the calling agent's reasoning loop can see them and decide what to do.

That last bullet is the load-bearing part. The agent doesn't have to silently trust whatever Parallel returns — it can read the warning, see that the result for `current_ceo` came back at low confidence, and make a follow-up call. The follow-up uses `previous_interaction_id` to anchor the new query to the same research thread, so the agent can ask a sharper question without losing context: *"You said the CEO is X with low confidence — what specific sources do you have on that, and is there a more recent appointment?"*

This is the part most research-agent recipes leave on the table. The agent can know its own confidence; we just have to give it that information.

## Five subagents, then a fan-out

The orchestration is straight Deep Agents. We define a handful of specialized subagents, each with a focused system prompt and the `research_task` tool, then we hand them to `create_deep_agent` along with a planning instruction.

```python
from deepagents import create_deep_agent
from deepagents.backends.filesystem import FilesystemBackend

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[ParallelWebSearchTool()],
    subagents=[
        corporate_profile_subagent,        # Phase 1
        financial_health_subagent,         # Phase 1
        litigation_subagent,               # Phase 1
        news_reputation_subagent,          # Phase 1
        competitive_landscape_subagent,    # Phase 1
        competitor_analysis_subagent,      # Phase 2 (fan-out)
    ],
    system_prompt=DILIGENCE_INSTRUCTIONS,
    backend=FilesystemBackend(root_dir="./reports", virtual_mode=True),
)
```

Five Phase-1 subagents fire in parallel. Each does one packed `research_task` call (and optionally one chained follow-up if Basis flags a low-confidence field), writes its findings to its own workpaper file in the agent's filesystem, and returns. The five workpapers — `corporate-profile.md`, `financial-health.md`, `litigation-regulatory.md`, `news-reputation.md`, `competitive-landscape.md` — are the raw evidence the orchestrator will synthesize.

The interesting move is **Phase 2**. The `competitive-landscape` subagent's output is intentionally narrow: it returns the names of the target's top three competitors with one-line context each. It does not produce a deep per-competitor profile. Instead, the orchestrator reads that list and **dispatches one new `competitor-analysis` subagent instance per competitor**, in parallel.

This is the canonical Deep Agents pattern: spawning N instances of the same subagent type for N parallel investigations, with isolated context per instance so the orchestrator's window stays clean. For our Rivian run that meant three parallel `competitor-analysis` subagents — Tesla, Ford, Mercedes — each producing its own `competitor-tesla.md`, `competitor-ford.md`, `competitor-mercedes.md` workpaper.

Without fan-out, you get "Tesla, Ford, and Mercedes are the main competitors" in a paragraph. With fan-out, you get a comparative table where each competitor is its own analyzed sub-section, and the orchestrator can synthesize a comparative competitor section that actually says useful things — strengths, weaknesses, recent strategic moves, near-term vs long-term threat level.

## The disk-backed filesystem matters

Deep Agents has a virtual filesystem by default — workpapers exist as state inside the agent run, then evaporate when the run ends. That's fine for ephemeral demos but unhelpful when the artifact you want is a 33KB memo with eight supporting documents.

The fix is `FilesystemBackend(root_dir="./reports", virtual_mode=True)`. The `virtual_mode=True` flag is critical: with the default (`False`), absolute paths the agent picks (like `/workpapers/foo.md`) bypass `root_dir` entirely and try to write to the actual filesystem root, which silently fails. With `virtual_mode=True`, the agent's virtual paths anchor to your configured root, and files actually land where you expect.

After a run, you have a real `reports/workpapers/` directory you can `cat`, search, or paste into a code review. The Rivian sample run committed in the cookbook has eight workpapers totaling 134KB plus a 33KB synthesized memo — auditable, reviewable, diffable.

## What the agent actually produced

The Rivian run came back with the things you'd hope a competent junior associate's first draft would catch:

- **A funding-figure cross-reference resolution.** The `financial-health` workpaper initially had an inconsistency with the corporate profile's funding total. The orchestrator flagged it during synthesis and noted in the final memo: *"One research track reported ~$3.7B total raised — this figure reflected pre-Series F data; confirmed total through Series G is ~$6.3B."* That's the orchestrator reasoning across workpapers and fixing a discrepancy, not just stitching them together.

- **A specific JV-conflict finding.** The Phase-2 fan-out for VW (the Scout Motors angle) surfaced a concrete risk: *"VW/Scout conflict of interest — no public non-compete provisions identified in JV disclosures; intensifies post-2027 when Scout launches an explicit ~$20K undercutter of R1T."* That's the kind of decision-relevant detail you don't get from a generic competitive-landscape paragraph.

- **A material correction the synthesis caught.** Phase-1 financial-health initially under-weighted Rivian's $6.6B DOE ATVM loan. The orchestrator flagged it during cross-reference and the final memo reads: *"DOE ATVM loan — $6.57B finalized early 2026 — underweighted in base workpaper, flagged as material correction."*

- **Calibrated risk severity.** The litigation-regulatory section ranks each finding by severity tier (red / orange / green) with explicit verification asks at the bottom — Crews v. Rivian securities settlement (preliminary approval; final hearing May 15, 2026), Tesla trade-secret case (PACER verification needed), Bosch breach-of-contract dispute.

None of this is magic — it's what you get when an agent has access to per-field confidence and the affordance to chain a follow-up. The architecture just makes "ask sharper questions when the first answer is shaky" a first-class behavior.

## Numbers

At default tier (Parallel `core-fast` Task processor), the Rivian run cost roughly $0.75–$1.50 in Parallel API calls and about 14 minutes wall-clock. Eight competitor-analysis subagents and Phase-1 chained follow-ups, total of 10 Task API calls. The full breakdown:

- Phase 1: 5 subagents × 1 packed Task call each + 2 chained follow-ups (financial-health, litigation-regulatory) = 7 calls
- Phase 2: 3 competitor-analysis subagents × 1 Task call each = 3 calls
- Phase 3 synthesis: zero additional Task calls (orchestrator reads workpapers and writes the memo)

Tier up to Parallel's `pro-fast` or `ultra` if you want richer reasoning per call; the README has a cost table.

## Run it

```bash
git clone https://github.com/parallel-web/parallel-cookbook
cd parallel-cookbook/python-recipes/parallel-deepagents-due-diligence

uv venv
uv pip install -e .
cp .env.example .env  # then fill in ANTHROPIC_API_KEY + PARALLEL_API_KEY

uv run python agent.py
```

Get a Parallel API key at [platform.parallel.ai](https://platform.parallel.ai). The recipe ships with the full Rivian sample output committed under `reports/workpapers/`, so you can preview the artifact shape before committing your own keys.

## Adapting the agent

Five tracks for company DD is the worked example. The pattern transfers cleanly to any multi-source research workflow where an agent should be able to ask sharper questions when the first answer is shaky — KYB onboarding, vendor risk, M&A target screening, claims investigation. Each domain swap is a different set of subagent system prompts; the underlying architecture (Phase 1 parallel subagents → Phase 2 fan-out → Phase 3 synthesis, with `parse_basis` + `previous_interaction_id` doing the confidence-aware lifting) stays identical.

Cookbook: [parallel-cookbook/python-recipes/parallel-deepagents-due-diligence](https://github.com/parallel-web/parallel-cookbook/tree/main/python-recipes/parallel-deepagents-due-diligence).
