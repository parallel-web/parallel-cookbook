/**
 * Task API: create runs and wait for results. No app logic here; the request
 * bodies are built in src/sheet/*.ts and src/updates/spec.ts, and runs are
 * started and tracked by src/pipeline/runs.ts.
 */
import type { FieldBasis, TaskRun, TaskRunCreateParams, TaskRunResult } from "parallel-web/resources/task-run";

import type { Parallel } from "./client";

export type { FieldBasis, TaskRun, TaskRunResult };

/** What the pipeline stores for every run: the run, its input, the spec key and the result. */
export interface StoredRun {
  run: TaskRun;
  input: Record<string, unknown>;
  spec: string;
  result: TaskRunResult | null;
  previousInteractionId?: string | null;
}

export async function createRun(client: Parallel, request: TaskRunCreateParams & { input: Record<string, unknown> }, spec: string): Promise<StoredRun> {
  const run = await client.taskRun.create(request, { maxRetries: 0 });
  return { run, input: request.input, spec, result: null, previousInteractionId: request.previous_interaction_id };
}

/**
 * Long-polls the result endpoint. Each request asks the API to hold for up to
 * 100 s, inside a 115 s client timeout, until the run is terminal.
 */
export async function awaitResult(
  client: Parallel,
  runId: string,
  onWait?: (elapsedSeconds: number) => void,
  maxMinutes = 90,
): Promise<TaskRunResult> {
  const started = Date.now();
  for (;;) {
    try {
      // The API holds the request up to `timeout` seconds; the client must wait longer and not retry.
      return await client.taskRun.result(runId, { timeout: 100 }, { timeout: 115_000, maxRetries: 0 });
    } catch (error) {
      const status = (error as { status?: number }).status;
      // 408: still running when the hold expired. Anything else is a real failure unless the run is still going.
      if (status !== 408 && status !== 504) {
        const run = await client.taskRun.retrieve(runId).catch(() => null);
        if (!run?.is_active) throw error;
      }
    }
    const elapsed = (Date.now() - started) / 1000;
    onWait?.(Math.round(elapsed));
    if (elapsed > maxMinutes * 60) throw new Error(`Run ${runId} did not finish within ${maxMinutes} minutes`);
  }
}
