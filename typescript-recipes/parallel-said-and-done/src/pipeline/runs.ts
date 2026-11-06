/**
 * Starting Task runs. Every run this app starts carries the webhook (when
 * WEBHOOK_URL is set) and is recorded as in flight for its company until its
 * result is handled (src/pipeline/advance.ts). Locally, without a webhook,
 * `drive` waits on the same records (src/pipeline/drive.ts).
 */
import type { TaskRunCreateParams } from "parallel-web/resources/task-run";

import type { Parallel } from "../parallel/client";
import { createRun, type StoredRun } from "../parallel/task";
import { readInflight, writeInflight, writeRaw, type InflightRun } from "../store";

/** Where Parallel sends task_run.status and monitor events, e.g. https://example.com/api/webhooks/parallel. */
export function webhookUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.WEBHOOK_URL?.trim() || null;
}

export function taskWebhook(env: NodeJS.ProcessEnv = process.env) {
  const url = webhookUrl(env);
  return url ? { url, event_types: ["task_run.status" as const] } : undefined;
}

/** Starts one run and records it as in flight. Call with the company's lock held. */
export async function startRun(
  client: Parallel,
  ticker: string,
  kind: InflightRun["kind"],
  request: TaskRunCreateParams & { input: Record<string, unknown> },
  spec: string,
  extra: { promise?: string; log?: (line: string) => void } = {},
): Promise<StoredRun> {
  const webhook = taskWebhook();
  const body = { ...request, ...(webhook ? { webhook } : {}) };
  let stored: StoredRun;
  try {
    stored = await createRun(client, body, spec);
  } catch (error) {
    // Chaining only carries context forward; the input already holds what the run needs. A previous run
    // this key cannot read (made under another Parallel account, or expired) is skipped, not fatal.
    if (!body.previous_interaction_id || !/interaction context not found/i.test(String((error as Error).message))) throw error;
    stored = await createRun(client, { ...body, previous_interaction_id: null }, spec);
    extra.log?.(`${ticker}: previous interaction ${body.previous_interaction_id} is not readable with this key; ${spec} run starts unchained`);
  }
  await writeRaw(ticker, kind, stored.run.run_id, stored);
  const inflight = await readInflight(ticker);
  inflight[stored.run.run_id] = { kind, spec, ...(extra.promise ? { promise: extra.promise } : {}), startedAt: new Date().toISOString() };
  await writeInflight(ticker, inflight);
  return stored;
}
