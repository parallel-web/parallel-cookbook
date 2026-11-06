/**
 * Every Parallel webhook this app receives: task_run.status for its Task runs
 * and monitor.event.detected for its monitors. It answers at once and does the
 * work after the response (Next.js `after`), within the function's time limit.
 *
 * The body is only a hint. Handlers fetch the run or the monitor's events from
 * the API with this app's key and act only on runs it started and monitors it
 * owns, so a forged request can at most make it re-read its own state.
 * Anything a webhook misses, the hourly reconcile picks up.
 */
import { after } from "next/server";

import { parallelClient, publicError } from "../../../../parallel/client";
import { onRunComplete } from "../../../../pipeline/advance";
import { onMonitorWebhook } from "../../../../updates/monitors";

export const runtime = "nodejs";
export const maxDuration = 800;

const log = (line: string) => console.log(line);

export async function POST(request: Request) {
  if (!process.env.PARALLEL_API_KEY) return Response.json({ ok: true, ignored: "not configured" });
  const body = (await request.json().catch(() => null)) as { type?: string; data?: Record<string, unknown> } | null;
  const data = body?.data ?? {};
  const client = parallelClient();

  if (body?.type === "task_run.status" && typeof data.run_id === "string" && /^trun_\w+$/.test(data.run_id)) {
    const runId = data.run_id;
    after(() => onRunComplete(client, runId, log).catch((error) => log(`webhook ${runId}: ${publicError(error)}`)));
    return Response.json({ ok: true });
  }

  const event = (data.event ?? {}) as Record<string, unknown>;
  if (body?.type === "monitor.event.detected" && typeof data.monitor_id === "string" && typeof event.event_group_id === "string") {
    const { monitor_id: monitorId } = data;
    const groupId = event.event_group_id;
    const ticker = typeof (data.metadata as Record<string, unknown> | undefined)?.ticker === "string" ? String((data.metadata as Record<string, unknown>).ticker) : null;
    after(() => onMonitorWebhook(client, monitorId, groupId, ticker, log).catch((error) => log(`webhook ${monitorId}: ${publicError(error)}`)));
    return Response.json({ ok: true });
  }

  // monitor.execution.completed / failed and anything else: acknowledged, nothing to do.
  return Response.json({ ok: true, ignored: body?.type ?? "unknown" });
}
