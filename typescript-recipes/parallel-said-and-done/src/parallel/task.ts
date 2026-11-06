/**
 * Task API: create runs, wait for results, run a Task Group. No app logic here;
 * the request bodies are built in src/sheet/spec.ts and src/updates/spec.ts.
 */
import type { TaskGroupGetRunsResponse } from "parallel-web/resources/task-group";
import type { FieldBasis, TaskRun, TaskRunCreateParams, TaskRunResult } from "parallel-web/resources/task-run";

import type { Parallel } from "./client";

export type { FieldBasis, TaskRun, TaskRunResult };

/** What the pipeline stores for every run: the run, its input, the spec key and the result. */
export interface StoredRun {
  run: TaskRun;
  input: Record<string, unknown>;
  spec: string;
  result: TaskRunResult | null;
}

export async function createRun(client: Parallel, request: TaskRunCreateParams & { input: Record<string, unknown> }, spec: string): Promise<StoredRun> {
  const run = await client.taskRun.create(request);
  return { run, input: request.input, spec, result: null };
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

type GroupRequest = TaskRunCreateParams & { input: Record<string, unknown>; metadata: Record<string, string> };

/** Creates a Task Group and adds one run per request, all with the same task spec. */
export async function startGroup(client: Parallel, requests: GroupRequest[], metadata: Record<string, string>) {
  const group = await client.taskGroup.create({ metadata });
  const added = await client.taskGroup.addRuns(group.taskgroup_id, {
    default_task_spec: requests[0].task_spec,
    inputs: requests.map((r) => ({ processor: r.processor, input: r.input, metadata: r.metadata, enable_events: false })),
  });
  return { groupId: group.taskgroup_id, runIds: added.run_ids };
}

/** Waits for a group to finish. Resumable: a dropped connection is logged and retried. */
export async function awaitGroup(client: Parallel, groupId: string, log: (line: string) => void, maxMinutes = 150) {
  const started = Date.now();
  for (;;) {
    const group = await client.taskGroup.retrieve(groupId).catch((error: Error) => {
      log(`group ${groupId}: ${error.message}; retrying`);
      return null;
    });
    if (group && !group.status.is_active) return group;
    if (group) log(`group ${groupId}: ${JSON.stringify(group.status.task_run_status_counts)}`);
    if (Date.now() - started > maxMinutes * 60_000) throw new Error(`group ${groupId} is still running; resume with --group ${groupId}`);
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

/** Every run in a finished group, with its input and output. */
export async function groupResults(client: Parallel, groupId: string) {
  const stream = await client.taskGroup.getRuns(groupId, { include_input: true, include_output: true });
  const runs: Extract<TaskGroupGetRunsResponse, { type: "task_run.state" }>[] = [];
  for await (const event of stream) if (event.type === "task_run.state") runs.push(event);
  return runs;
}
