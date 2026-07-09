import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { ParallelTaskClient } from "@/lib/parallel/task-client";
import { persistAssessmentForRun } from "@/lib/server/research";
import type { BasisEntry, DeepResearchOutput } from "@/lib/parallel/types";
import { verifyToken } from "@/lib/server/webhook-token";
import { getActiveIntegration, markIntegrationUsed } from "@/lib/server/integrations";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TaskWebhookPayload {
  type?: string;
  data?: {
    run_id?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  };
  // Some webhook flavors place fields at the top level.
  run_id?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  if (!(await verifyToken("research", token))) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let payload: TaskWebhookPayload;
  try {
    payload = (await request.json()) as TaskWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const runId = payload.data?.run_id ?? payload.run_id;
  const status = payload.data?.status ?? payload.status;
  if (!runId) {
    return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
  }

  const { data: assessment } = await db()
    .from("risk_assessments")
    .select("id, account_id, vendor_id, status")
    .eq("parallel_run_id", runId)
    .maybeSingle();

  if (!assessment) {
    // Race: the webhook can arrive before runResearchForVendors finishes
    // inserting the pending risk_assessments row (Parallel sometimes
    // delivers a task_run.status webhook within ms of taskGroup.addRuns
    // returning). Returning 503 with Retry-After tells Parallel to redeliver
    // after the local DB insert has had time to commit, instead of dropping
    // the assessment on the floor.
    return NextResponse.json(
      { ok: false, retry: true, reason: "assessment_not_yet_persisted" },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

  if (status && status !== "completed" && status !== "failed" && status !== "cancelled") {
    // queued / running — store progress and bail.
    await db()
      .from("risk_assessments")
      .update({ status: "running" })
      .eq("id", assessment.id);
    return NextResponse.json({ ok: true });
  }

  if (status === "failed" || status === "cancelled") {
    await db()
      .from("risk_assessments")
      .update({ status: "failed", summary: `Run ${status}` })
      .eq("id", assessment.id);
    return NextResponse.json({ ok: true });
  }

  // status === "completed": pull the actual output from Parallel using the
  // owning account's BYOK Parallel integration.
  const integration = await getActiveIntegration(assessment.account_id, "parallel");
  if (!integration) {
    console.error("[webhook/task] no active parallel integration for", assessment.account_id);
    return NextResponse.json({ ok: true, ignored: true });
  }
  await markIntegrationUsed(assessment.account_id, integration.id);

  const client = new ParallelTaskClient({
    apiKey: integration.secret,
    baseUrl: env().PARALLEL_BASE_URL,
  });

  // Get the actual run output (the webhook only carries status by default).
  // V1 results carry `output.basis` alongside `output.content`; we forward
  // both so the scorer can emit top_citations into the audit row.
  //
  // `getRunResult` returns null on a 404 — that can mean the result store
  // hasn't materialized the row yet (the webhook fires before result
  // storage finishes in some Parallel deployments). Treat it as transient
  // and leave the assessment in `status: "running"` so cron/sweep →
  // reconcileTaskGroupResults reconciles it on the next tick.
  let output: DeepResearchOutput | null = null;
  let basis: BasisEntry[] = [];
  let fetchErrored = false;
  let resultMissing = false;
  try {
    const result = await client.getRunResult(runId);
    if (result === null) {
      resultMissing = true;
    } else {
      output = (result.output?.content as unknown as DeepResearchOutput) ?? null;
      basis = (result.output?.basis ?? []) as BasisEntry[];
    }
  } catch (err) {
    fetchErrored = true;
    console.error("[webhook/task] failed to fetch result", runId, err);
  }

  if (!output) {
    if (resultMissing || fetchErrored) {
      // Transient — leave row running so cron/sweep can retry.
      await db()
        .from("risk_assessments")
        .update({ status: "running" })
        .eq("id", assessment.id);
      return NextResponse.json({ ok: true, deferred: true });
    }
    // Status was "completed" but the result payload was empty/unknown shape
    // — this is a real failure, not a transient miss.
    await db()
      .from("risk_assessments")
      .update({ status: "failed", summary: "Result fetch failed" })
      .eq("id", assessment.id);
    return NextResponse.json({ ok: true });
  }

  await persistAssessmentForRun({
    accountId: assessment.account_id,
    runId,
    vendorId: assessment.vendor_id,
    output,
    basis,
  });

  return NextResponse.json({ ok: true });
}
