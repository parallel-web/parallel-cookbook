import "server-only";
import { db } from "./db";
import { env } from "./env";
import { researchWebhookUrl } from "./webhook-token";
import { notifyAssessment } from "./notifications";
import { ParallelTaskClient } from "@/lib/parallel/task-client";
import { RiskScorer, safeDim } from "@/lib/parallel/risk-scorer";
import { buildResearchPrompt, RESEARCH_OUTPUT_SCHEMA } from "@/lib/parallel/research-prompt";
import type {
  BasisEntry,
  DeepResearchOutput,
  TaskRunInput,
  VendorForResearch,
} from "@/lib/parallel/types";
import type { VendorRow } from "./vendors";

const NEXT_RESEARCH_DAYS = 7;

export interface RunResearchResult {
  taskGroupId: string;
  total: number;
  /** assessment row ids in pending state */
  assessmentIds: string[];
}

export async function runResearchForVendors(
  accountId: string,
  apiKey: string,
  vendors: VendorRow[],
): Promise<RunResearchResult> {
  if (vendors.length === 0) {
    throw new Error("No vendors provided");
  }

  const e = env();
  const client = new ParallelTaskClient({
    apiKey,
    baseUrl: e.PARALLEL_BASE_URL,
    defaultProcessor: e.PARALLEL_RESEARCH_PROCESSOR,
  });

  const group = await client.createTaskGroup();
  const webhook = await researchWebhookUrl();

  const inputs: TaskRunInput[] = vendors.map((v) => {
    const vfr: VendorForResearch = {
      vendor_name: v.vendor_name,
      vendor_domain: v.vendor_domain,
      vendor_category: v.vendor_category,
      monitoring_priority: v.monitoring_priority,
    };
    return {
      input: buildResearchPrompt(vfr),
      processor: e.PARALLEL_RESEARCH_PROCESSOR,
      metadata: {
        vendor_id: v.id,
        account_id: v.account_id,
        kind: "research",
      },
      webhook: { url: webhook, events: ["task_run.status"] },
    };
  });

  const runIds = await client.addRunsToGroup(group.taskgroup_id, inputs, {
    output_schema: RESEARCH_OUTPUT_SCHEMA,
  });

  // Persist task group rollup row.
  await db().from("task_groups").upsert(
    {
      account_id: accountId,
      task_group_id: group.taskgroup_id,
      total_runs: runIds.length,
      kind: "research",
      status: "running",
    },
    { onConflict: "task_group_id" },
  );

  // Persist a pending risk_assessments row per vendor so the dashboard
  // immediately reflects "researching..." state.
  const assessmentRows: string[] = [];
  for (let i = 0; i < vendors.length; i++) {
    const vendor = vendors[i];
    const runId = runIds[i];
    const previous = await db()
      .from("risk_assessments")
      .select("score")
      .eq("vendor_id", vendor.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: insertedAssessment, error } = await db()
      .from("risk_assessments")
      .insert({
        account_id: accountId,
        vendor_id: vendor.id,
        parallel_run_id: runId,
        task_group_id: group.taskgroup_id,
        status: "running",
        previous_score: previous.data?.score ?? null,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[research] failed to insert pending assessment", error);
      continue;
    }
    assessmentRows.push(insertedAssessment.id);
  }

  await db().from("audit_log").insert({
    account_id: accountId,
    actor: "user",
    action: "research.kicked_off",
    subject: group.taskgroup_id,
    metadata: { vendor_count: vendors.length },
  });

  return {
    taskGroupId: group.taskgroup_id,
    total: vendors.length,
    assessmentIds: assessmentRows,
  };
}

/**
 * Refresh task group rollup status by polling the API. Returns the latest
 * counts so the onboarding/research progress UI can render them.
 */
export async function refreshTaskGroupStatus(
  accountId: string,
  apiKey: string,
  taskGroupId: string,
): Promise<{ total: number; completed: number; failed: number; isActive: boolean }> {
  const e = env();
  const client = new ParallelTaskClient({
    apiKey,
    baseUrl: e.PARALLEL_BASE_URL,
    defaultProcessor: e.PARALLEL_RESEARCH_PROCESSOR,
  });
  const status = await client.getTaskGroupStatus(taskGroupId);
  const counts = status.status.task_run_status_counts ?? {};
  const completed = counts.completed ?? 0;
  const failed = (counts.failed ?? 0) + (counts.cancelled ?? 0);
  const isActive = status.status.is_active;
  const overall: "running" | "completed" | "failed" =
    isActive ? "running" : failed === status.status.num_task_runs ? "failed" : "completed";

  await db()
    .from("task_groups")
    .update({
      total_runs: status.status.num_task_runs,
      completed_runs: completed,
      failed_runs: failed,
      status: overall,
    })
    .eq("account_id", accountId)
    .eq("task_group_id", taskGroupId);

  // If the group has finished but some runs never delivered a webhook, pull
  // their results down inline so the dashboard isn't stuck on "running".
  if (!isActive) {
    await reconcileTaskGroupResults(accountId, apiKey, taskGroupId);
  }

  return {
    total: status.status.num_task_runs,
    completed,
    failed,
    isActive,
  };
}

/**
 * For task groups whose runs may have completed without delivering a
 * webhook, fetch results and persist them.
 */
async function reconcileTaskGroupResults(
  accountId: string,
  apiKey: string,
  taskGroupId: string,
): Promise<void> {
  const e = env();
  const client = new ParallelTaskClient({
    apiKey,
    baseUrl: e.PARALLEL_BASE_URL,
    defaultProcessor: e.PARALLEL_RESEARCH_PROCESSOR,
  });

  const { data: pending } = await db()
    .from("risk_assessments")
    .select("id, parallel_run_id, vendor_id")
    .eq("account_id", accountId)
    .eq("task_group_id", taskGroupId)
    .in("status", ["pending", "running"]);

  if (!pending?.length) return;

  let results: Awaited<ReturnType<typeof client.getTaskGroupResults>>;
  try {
    results = await client.getTaskGroupResults(taskGroupId, true);
  } catch (err) {
    console.error("[research] failed to fetch group results", err);
    return;
  }

  const byRun = new Map(results.map((r) => [r.run_id, r]));
  for (const row of pending) {
    if (!row.parallel_run_id) continue;
    const result = byRun.get(row.parallel_run_id);
    if (!result) continue;
    if (result.status === "completed" && result.output) {
      // Forward `basis` so the scorer can attach top citations to the
      // persisted assessment without re-fetching from Parallel.
      await persistAssessmentForRun({
        accountId,
        runId: row.parallel_run_id,
        vendorId: row.vendor_id,
        output: result.output.content as unknown as DeepResearchOutput,
        basis: (result.output.basis ?? []) as BasisEntry[],
      });
    } else if (result.status === "failed" || result.status === "cancelled") {
      await db()
        .from("risk_assessments")
        .update({ status: "failed", summary: result.error ?? `Run ${result.status}` })
        .eq("id", row.id);
    }
  }
}

export interface PersistAssessmentInput {
  accountId: string;
  runId: string;
  vendorId: string;
  output: DeepResearchOutput;
  /** Task API `output.basis` — per-field citations + reasoning + confidence. */
  basis?: BasisEntry[];
}

/**
 * Score a Parallel deep-research output, write it to risk_assessments,
 * advance the vendor's next_research_date, and append an audit log entry.
 */
export async function persistAssessmentForRun(input: PersistAssessmentInput): Promise<void> {
  const scorer = new RiskScorer();

  const { data: vendor } = await db()
    .from("vendors")
    .select("id, vendor_name, risk_tier_override, next_research_date, monitoring_priority")
    .eq("id", input.vendorId)
    .eq("account_id", input.accountId)
    .maybeSingle();

  const overrides = vendor?.risk_tier_override
    ? { risk_tier_override: vendor.risk_tier_override }
    : undefined;

  const assessment = scorer.scoreDeepResearch(input.output, overrides, input.basis);
  const score = scorer.scoreToNumber(assessment);
  const topCitation = assessment.top_citations?.[0];

  // Pull the previous score so we can compute movement.
  const { data: previous } = await db()
    .from("risk_assessments")
    .select("score, parallel_run_id, created_at")
    .eq("vendor_id", input.vendorId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousScore = previous?.score ?? null;
  const movement = previousScore == null ? 0 : score - previousScore;

  // safeDim() backfills `{status:"unknown", findings:"", severity:"LOW"}` for
  // any dimension that's missing or malformed in the upstream output. Without
  // this guard, a partial DeepResearchOutput tripped a TypeError accessing
  // `.severity` (finding 19).
  const dimensions = [
    {
      key: "financial_health",
      label: "Financial health",
      ...safeDim(input.output.financial_health),
    },
    {
      key: "legal_regulatory",
      label: "Legal & regulatory",
      ...safeDim(input.output.legal_regulatory),
    },
    {
      key: "cybersecurity",
      label: "Cybersecurity",
      ...safeDim(input.output.cybersecurity),
    },
    {
      key: "leadership_governance",
      label: "Leadership & governance",
      ...safeDim(input.output.leadership_governance),
    },
    {
      key: "esg_reputation",
      label: "ESG & reputation",
      ...safeDim(input.output.esg_reputation),
    },
  ];

  const { error } = await db()
    .from("risk_assessments")
    .update({
      status: "completed",
      risk_level: assessment.risk_level,
      score,
      previous_score: previousScore,
      movement,
      recommendation: assessment.recommendation,
      adverse_flag: assessment.adverse_flag,
      action_required: assessment.action_required,
      dimensions,
      adverse_events: input.output.adverse_events ?? [],
      triggered_overrides: assessment.triggered_overrides,
      summary: assessment.summary,
      raw_output: input.output,
      assessment_date: input.output.assessment_date || new Date().toISOString().slice(0, 10),
    })
    .eq("parallel_run_id", input.runId);

  if (error) {
    console.error("[research] failed to update assessment", error);
    return;
  }

  // Advance next research date.
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + NEXT_RESEARCH_DAYS);
  await db()
    .from("vendors")
    .update({ next_research_date: next.toISOString().slice(0, 10) })
    .eq("id", input.vendorId)
    .eq("account_id", input.accountId);

  await db().from("audit_log").insert({
    account_id: input.accountId,
    actor: "system",
    action: "assessment.completed",
    subject: vendor?.vendor_name ?? input.vendorId,
    metadata: {
      risk_level: assessment.risk_level,
      score,
      movement,
      run_id: input.runId,
      // Top citation gets first-class status on the audit row so the
      // dashboard / Sheets export can render "why was this flagged"
      // without touching Parallel again.
      top_citation_url: topCitation?.url,
      top_citation_title: topCitation?.title,
      confidence: topCitation?.confidence,
    },
  });

  // Best-effort fan out to the user's BYOK Slack + email integrations.
  // notifyAssessment swallows per-channel errors and is a no-op for LOW/MEDIUM.
  try {
    await notifyAssessment({
      accountId: input.accountId,
      vendorName: vendor?.vendor_name ?? "Unknown vendor",
      riskLevel: assessment.risk_level,
      summary: assessment.summary,
      recommendation: assessment.recommendation,
      source: "deep_research",
      url: `${env().APP_URL}/vendors/${input.vendorId}`,
    });
  } catch (err) {
    console.error("[research] notify failed", err);
  }
}
