import Parallel from "parallel-web";
import {
  ParallelApiError,
  RunNotCompleteError,
  TaskGroupTimeoutError,
  TaskRunSchema,
  TaskRunResultSchema,
  TaskGroupSchema,
  TaskGroupStatusSchema,
  TaskGroupResultsSchema,
  type TaskRun,
  type TaskRunResult,
  type TaskRunInput,
  type TaskGroup,
  type TaskGroupStatus,
  type TaskGroupResults,
  type CreateRunParams,
  type OutputSchema,
} from "../models/task-api.js";

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_RUNS_PER_REQUEST = 1000;

// ── Options ────────────────────────────────────────────────────────────────

export interface ParallelTaskClientOptions {
  apiKey: string;
  baseUrl?: string;
  defaultProcessor?: string;
  /** Per-request timeout in ms. Defaults to SDK default of 60s. */
  timeout?: number;
  /** SDK-level retry count for 408/409/429/5xx. Defaults to 3. */
  maxRetries?: number;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Client ─────────────────────────────────────────────────────────────────

// Wraps `parallel-web` for the Task + Task Group APIs. We follow the same
// pattern as the monitor client: typed SDK call, then re-validate with zod
// so the rest of the system can rely on our existing schemas.
export class ParallelTaskClient {
  private readonly sdk: Parallel;
  private readonly defaultProcessor: string;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  constructor(options: ParallelTaskClientOptions) {
    this.defaultProcessor = options.defaultProcessor ?? "ultra8x";
    this.log = options.logger ?? console;
    this.sdk = new Parallel({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      timeout: options.timeout ?? 60_000,
      maxRetries: options.maxRetries ?? 3,
    });
  }

  // ── Task Run Methods ───────────────────────────────────────────────────

  async createRun(params: CreateRunParams): Promise<TaskRun> {
    const { input, processor, outputSchema, webhook } = params;

    this.log.debug("[parallel] taskRun.create", {
      processor: processor ?? this.defaultProcessor,
      hasSchema: !!outputSchema,
      hasWebhook: !!webhook,
    });

    const data = await this.invoke(() =>
      this.sdk.taskRun.create({
        input,
        processor: processor ?? this.defaultProcessor,
        ...(outputSchema
          ? { task_spec: { output_schema: outputSchema } }
          : {}),
        ...(webhook
          ? {
              webhook: {
                url: webhook.url,
                event_types: webhook.events ?? ["task_run.status"],
              },
            }
          : {}),
      } as Parameters<Parallel["taskRun"]["create"]>[0]),
    );

    return TaskRunSchema.parse(data);
  }

  async getRunStatus(runId: string): Promise<TaskRun> {
    this.log.debug("[parallel] taskRun.retrieve %s", runId);
    const data = await this.invoke(() => this.sdk.taskRun.retrieve(runId));
    return TaskRunSchema.parse(data);
  }

  async getRunResult(runId: string): Promise<TaskRunResult> {
    const status = await this.getRunStatus(runId);

    if (status.status !== "completed") {
      throw new RunNotCompleteError(runId, status.status);
    }

    this.log.debug("[parallel] taskRun.result %s", runId);
    const data = await this.invoke(() => this.sdk.taskRun.result(runId));
    // SDK returns { output, run } — our schema matches { output: ... } and
    // tolerates extra fields via passthrough.
    return TaskRunResultSchema.parse(data);
  }

  /**
   * Block until the run is `completed`, then return the result. Internally
   * the SDK `result()` long-polls with the `timeout` query param.
   * `apiTimeoutSeconds` (max 1h) is forwarded to the API.
   */
  async waitForResult(
    runId: string,
    apiTimeoutSeconds: number = 1800,
  ): Promise<TaskRunResult> {
    this.log.debug(
      "[parallel] taskRun.result (long-poll) %s timeout=%d",
      runId,
      apiTimeoutSeconds,
    );
    const data = await this.invoke(() =>
      this.sdk.taskRun.result(runId, { timeout: apiTimeoutSeconds }),
    );
    return TaskRunResultSchema.parse(data);
  }

  // ── Task Group Methods ─────────────────────────────────────────────────

  async createTaskGroup(): Promise<TaskGroup> {
    this.log.debug("[parallel] taskGroup.create");
    const data = await this.invoke(() => this.sdk.taskGroup.create({}));
    // Re-shape to our TaskGroup zod schema (only requires taskgroup_id).
    return TaskGroupSchema.parse(data);
  }

  async addRunsToGroup(
    taskGroupId: string,
    runs: TaskRunInput[],
    defaultTaskSpec?: { output_schema: OutputSchema },
  ): Promise<string[]> {
    const allRunIds: string[] = [];

    for (let i = 0; i < runs.length; i += MAX_RUNS_PER_REQUEST) {
      const chunk = runs.slice(i, i + MAX_RUNS_PER_REQUEST);
      const batchNum = Math.floor(i / MAX_RUNS_PER_REQUEST) + 1;

      this.log.debug(
        "[parallel] taskGroup.addRuns %s (batch %d, %d runs)",
        taskGroupId,
        batchNum,
        chunk.length,
      );

      const response = await this.invoke(() =>
        this.sdk.taskGroup.addRuns(taskGroupId, {
          inputs: chunk.map((r) => ({
            input: r.input,
            processor: r.processor ?? this.defaultProcessor,
          })),
          ...(defaultTaskSpec
            ? { default_task_spec: { output_schema: defaultTaskSpec.output_schema } }
            : {}),
        } as Parameters<Parallel["taskGroup"]["addRuns"]>[1]),
      );

      allRunIds.push(...response.run_ids);
    }

    return allRunIds;
  }

  async getTaskGroupStatus(taskGroupId: string): Promise<TaskGroupStatus> {
    this.log.debug("[parallel] taskGroup.retrieve %s", taskGroupId);
    const data = await this.invoke(() =>
      this.sdk.taskGroup.retrieve(taskGroupId),
    );
    return TaskGroupStatusSchema.parse(data);
  }

  /**
   * Stream every run in the group via `taskGroup.getRuns` and collect them
   * into the legacy array shape our orchestrator expects. With
   * `include_output=true` each yielded event already carries the
   * structured output (including `basis`).
   */
  async getTaskGroupResults(
    taskGroupId: string,
    includeOutput: boolean = true,
  ): Promise<TaskGroupResults> {
    this.log.debug(
      "[parallel] taskGroup.getRuns %s include_output=%s",
      taskGroupId,
      includeOutput,
    );

    const stream = await this.invoke(() =>
      this.sdk.taskGroup.getRuns(taskGroupId, {
        include_output: includeOutput,
      }),
    );

    const runs: unknown[] = [];
    for await (const event of stream) {
      // The stream yields `TaskRunEvent | ErrorEvent`. We keep only the
      // state events — terminal runs (completed/failed/cancelled).
      const ev = event as { type?: string; run?: unknown; output?: unknown };
      if (ev.type === "task_run.state" && ev.run) {
        runs.push({
          ...(ev.run as Record<string, unknown>),
          ...(ev.output ? { output: ev.output } : {}),
        });
      }
    }

    return TaskGroupResultsSchema.parse(runs);
  }

  async pollTaskGroupUntilComplete(
    taskGroupId: string,
    pollIntervalMs: number = 60_000,
    timeoutMs: number = 3_600_000,
  ): Promise<TaskGroupResults> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getTaskGroupStatus(taskGroupId);

      this.log.debug(
        "[parallel] Poll group %s: active=%s, completed=%d, failed=%d, total=%d",
        taskGroupId,
        status.status.is_active,
        status.status.task_run_status_counts.completed ?? 0,
        status.status.task_run_status_counts.failed ?? 0,
        status.status.num_task_runs,
      );

      if (!status.status.is_active) {
        return this.getTaskGroupResults(taskGroupId, true);
      }

      await this.sleep(pollIntervalMs);
    }

    throw new TaskGroupTimeoutError(taskGroupId, Date.now() - startTime);
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  // Translate SDK APIErrors into our ParallelApiError so existing catch
  // blocks keep working. The SDK already retries on transient failures.
  private async invoke<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Parallel.APIError) {
        throw new ParallelApiError(
          `Parallel API error ${err.status ?? "?"}: ${err.name}`,
          err.status ?? 0,
          (err as { message?: string }).message ?? "",
        );
      }
      throw err;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
