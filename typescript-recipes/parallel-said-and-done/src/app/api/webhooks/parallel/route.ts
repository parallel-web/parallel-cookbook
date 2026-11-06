/**
 * Every Parallel webhook this app receives: task_run.status for its Task runs
 * and monitor.event.detected for its monitors. It answers at once and does the
 * work after the response (Next.js `after`), within the function's time limit.
 *
 * Verify the raw delivery before scheduling any API or storage work.
 */
import { after } from "next/server";
import { Webhook } from "standardwebhooks";

import { parallelClient, publicError } from "../../../../parallel/client";
import { onRunComplete } from "../../../../pipeline/advance";
import { onMonitorWebhook } from "../../../../updates/monitors";

export const runtime = "nodejs";

const log = (line: string) => console.log(line);

export async function POST(request: Request) {
  if (!process.env.PARALLEL_API_KEY) return Response.json({ ok: true, ignored: "not configured" });
  const secret = process.env.PARALLEL_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook signing secret is not configured", { status: 503 });
  let body: { type?: string; data?: Record<string, unknown> } | null;
  try {
    body = new Webhook(secret).verify(await request.text(), Object.fromEntries(request.headers)) as typeof body;
  } catch {
    return new Response("Invalid webhook", { status: 401 });
  }
  const data = body?.data ?? {};
  const client = parallelClient();

  if (body?.type === "task_run.status" && typeof data.run_id === "string" && /^trun_\w+$/.test(data.run_id)) {
    const runId = data.run_id;
    after(() => onRunComplete(client, runId, log).catch((error) => log(`webhook ${runId}: ${publicError(error)}`)));
    return Response.json({ ok: true });
  }

  const event = (data.event ?? {}) as Record<string, unknown>;
  const groupId = body?.type === "monitor.event.detected" && typeof event.event_group_id === "string" ? event.event_group_id : null;
  if ((groupId || body?.type === "monitor.execution.completed") && typeof data.monitor_id === "string") {
    const { monitor_id: monitorId } = data;
    const ticker = typeof (data.metadata as Record<string, unknown> | undefined)?.ticker === "string" ? String((data.metadata as Record<string, unknown>).ticker) : null;
    after(() => onMonitorWebhook(client, monitorId, groupId, ticker, log).catch((error) => log(`webhook ${monitorId}: ${publicError(error)}`)));
    return Response.json({ ok: true });
  }

  return Response.json({ ok: true, ignored: body?.type ?? "unknown" });
}
