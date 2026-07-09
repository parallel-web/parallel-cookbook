import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  AxiosError,
} from "axios";
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

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const MAX_RUNS_PER_REQUEST = 1000;

// ── Options ────────────────────────────────────────────────────────────────

export interface ParallelTaskClientOptions {
  apiKey: string;
  baseUrl?: string;
  defaultProcessor?: string;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Client ─────────────────────────────────────────────────────────────────

export class ParallelTaskClient {
  private readonly http: AxiosInstance;
  private readonly defaultProcessor: string;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  constructor(options: ParallelTaskClientOptions) {
    this.defaultProcessor = options.defaultProcessor ?? "ultra8x";
    this.log = options.logger ?? console;

    this.http = axios.create({
      baseURL: options.baseUrl ?? "https://api.parallel.ai",
      headers: {
        "x-api-key": options.apiKey,
        "Content-Type": "application/json",
      },
      timeout: 60_000,
    });
  }

  // ── Task Run Methods ───────────────────────────────────────────────────

  async createRun(params: CreateRunParams): Promise<TaskRun> {
    const { input, processor, outputSchema, webhook } = params;

    const body: Record<string, unknown> = {
      input,
      processor: processor ?? this.defaultProcessor,
    };

    if (outputSchema) {
      body.task_spec = { output_schema: outputSchema };
    }

    if (webhook) {
      body.webhook = { url: webhook.url, events: webhook.events ?? ["task_run.status"] };
    }

    this.log.debug("[parallel] POST /v1/tasks/runs", {
      processor: body.processor,
      hasSchema: !!outputSchema,
      hasWebhook: !!webhook,
    });

    const data = await this.requestWithRetry<unknown>({
      method: "POST",
      url: "/v1/tasks/runs",
      data: body,
    });

    return TaskRunSchema.parse(data);
  }

  async getRunStatus(runId: string): Promise<TaskRun> {
    this.log.debug("[parallel] GET /v1/tasks/runs/%s", runId);

    const data = await this.requestWithRetry<unknown>({
      method: "GET",
      url: `/v1/tasks/runs/${runId}`,
    });

    return TaskRunSchema.parse(data);
  }

  async getRunResult(runId: string): Promise<TaskRunResult> {
    const status = await this.getRunStatus(runId);

    if (status.status !== "completed") {
      throw new RunNotCompleteError(runId, status.status);
    }

    this.log.debug("[parallel] GET /v1/tasks/runs/%s/result", runId);

    const data = await this.requestWithRetry<unknown>({
      method: "GET",
      url: `/v1/tasks/runs/${runId}/result`,
    });

    return TaskRunResultSchema.parse(data);
  }

  // ── Task Group Methods ─────────────────────────────────────────────────

  async createTaskGroup(): Promise<TaskGroup> {
    this.log.debug("[parallel] POST /v1beta/tasks/groups");

    const data = await this.requestWithRetry<unknown>({
      method: "POST",
      url: "/v1beta/tasks/groups",
      data: {},
    });

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
        "[parallel] POST /v1beta/tasks/groups/%s/runs (batch %d, %d runs)",
        taskGroupId,
        batchNum,
        chunk.length,
      );

      const body: Record<string, unknown> = { inputs: chunk };
      if (defaultTaskSpec) {
        body.default_task_spec = defaultTaskSpec;
      }

      const data = await this.requestWithRetry<{ run_ids: string[] }>({
        method: "POST",
        url: `/v1beta/tasks/groups/${taskGroupId}/runs`,
        data: body,
      });

      allRunIds.push(...data.run_ids);
    }

    return allRunIds;
  }

  async getTaskGroupStatus(taskGroupId: string): Promise<TaskGroupStatus> {
    this.log.debug("[parallel] GET /v1beta/tasks/groups/%s", taskGroupId);

    const data = await this.requestWithRetry<unknown>({
      method: "GET",
      url: `/v1beta/tasks/groups/${taskGroupId}`,
    });

    return TaskGroupStatusSchema.parse(data);
  }

  async getTaskGroupResults(
    taskGroupId: string,
    includeOutput: boolean = true,
  ): Promise<TaskGroupResults> {
    this.log.debug(
      "[parallel] GET /v1beta/tasks/groups/%s/runs (include_output=%s)",
      taskGroupId,
      includeOutput,
    );

    const data = await this.requestWithRetry<unknown[]>({
      method: "GET",
      url: `/v1beta/tasks/groups/${taskGroupId}/runs`,
      params: { include_output: includeOutput },
    });

    return TaskGroupResultsSchema.parse(data);
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

  private async requestWithRetry<T>(
    config: AxiosRequestConfig,
    maxRetries: number = 3,
    initialDelayMs: number = 1000,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.http.request<T>(config);
        return response.data;
      } catch (err) {
        if (!(err instanceof AxiosError) || !err.response) {
          throw err;
        }

        const status = err.response.status;
        lastError = err;

        if (!RETRYABLE_STATUS_CODES.has(status) || attempt === maxRetries) {
          const body =
            typeof err.response.data === "string"
              ? err.response.data
              : JSON.stringify(err.response.data ?? "");
          throw new ParallelApiError(
            `Parallel API error ${status}: ${config.method?.toUpperCase()} ${config.url}`,
            status,
            body,
          );
        }

        let delayMs = initialDelayMs * Math.pow(2, attempt);

        if (status === 429) {
          const retryAfter = err.response.headers?.["retry-after"];
          if (retryAfter) {
            const retryAfterMs = Number(retryAfter) * 1000;
            if (!isNaN(retryAfterMs) && retryAfterMs > delayMs) {
              delayMs = retryAfterMs;
            }
          }
        }

        this.log.debug(
          "[parallel] Retrying %s %s (attempt %d/%d, status %d, delay %dms)",
          config.method?.toUpperCase(),
          config.url,
          attempt + 1,
          maxRetries,
          status,
          delayMs,
        );

        await this.sleep(delayMs);
      }
    }

    throw lastError ?? new Error("Unexpected retry exhaustion");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
