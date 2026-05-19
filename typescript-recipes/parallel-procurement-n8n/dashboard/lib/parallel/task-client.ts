import Parallel from "parallel-web";
import {
  ParallelApiError,
  type CreateRunParams,
  type TaskGroup,
  type TaskGroupResults,
  type TaskGroupStatus,
  type TaskRun,
  type TaskRunInput,
  type TaskRunResult,
  type OutputSchema,
} from "./types";

const MAX_RUNS_PER_REQUEST = 1000;

export interface ParallelTaskClientOptions {
  apiKey: string;
  baseUrl?: string;
  defaultProcessor?: string;
  maxRetries?: number;
  timeout?: number;
}

/**
 * Dashboard-side Parallel Task API client. Uses the `parallel-web` SDK
 * (`client.taskRun.*`, `client.taskGroup.*`) and surfaces basis-carrying
 * results to the route handlers.
 */
export class ParallelTaskClient {
  private readonly sdk: Parallel;
  private readonly defaultProcessor: string;

  constructor(options: ParallelTaskClientOptions) {
    this.sdk = new Parallel({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      maxRetries: options.maxRetries ?? 3,
      timeout: options.timeout ?? 60_000,
    });
    this.defaultProcessor = options.defaultProcessor ?? "ultra8x";
  }

  async createRun(params: CreateRunParams): Promise<TaskRun> {
    return await this.invoke(async () => {
      const run = await this.sdk.taskRun.create({
        input: params.input,
        processor: params.processor ?? this.defaultProcessor,
        ...(params.outputSchema
          ? { task_spec: { output_schema: params.outputSchema } }
          : {}),
        ...(params.webhook
          ? {
              webhook: {
                url: params.webhook.url,
                event_types: params.webhook.events ?? ["task_run.status"],
              },
            }
          : {}),
        ...(params.metadata ? { metadata: params.metadata } : {}),
      } as Parameters<Parallel["taskRun"]["create"]>[0]);
      return run as unknown as TaskRun;
    });
  }

  async getRunStatus(runId: string): Promise<TaskRun> {
    return await this.invoke(async () => {
      const run = await this.sdk.taskRun.retrieve(runId);
      return run as unknown as TaskRun;
    });
  }

  /**
   * Best-effort result fetch. Returns null on 404 (run not found / not
   * yet stored) so the webhook handler can ignore stale callbacks
   * gracefully. Anything else falls through as ParallelApiError.
   */
  async getRunResult(runId: string): Promise<TaskRunResult | null> {
    try {
      const result = await this.invoke(() => this.sdk.taskRun.result(runId));
      return result as unknown as TaskRunResult;
    } catch (err) {
      if (err instanceof ParallelApiError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Long-poll the result endpoint. `apiTimeoutSeconds` is forwarded to
   * the API; the SDK leaves the connection open server-side until the
   * run completes or the timeout fires.
   */
  async waitForResult(
    runId: string,
    apiTimeoutSeconds: number = 1800,
  ): Promise<TaskRunResult> {
    return await this.invoke(async () => {
      const result = await this.sdk.taskRun.result(runId, {
        timeout: apiTimeoutSeconds,
      });
      return result as unknown as TaskRunResult;
    });
  }

  async createTaskGroup(): Promise<TaskGroup> {
    return await this.invoke(async () => {
      const group = await this.sdk.taskGroup.create({});
      return { taskgroup_id: group.taskgroup_id };
    });
  }

  async addRunsToGroup(
    taskGroupId: string,
    runs: TaskRunInput[],
    defaultTaskSpec?: { output_schema: OutputSchema },
  ): Promise<string[]> {
    const allRunIds: string[] = [];
    for (let i = 0; i < runs.length; i += MAX_RUNS_PER_REQUEST) {
      const chunk = runs.slice(i, i + MAX_RUNS_PER_REQUEST);
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
    return await this.invoke(async () => {
      const group = await this.sdk.taskGroup.retrieve(taskGroupId);
      return {
        taskgroup_id: group.taskgroup_id,
        status: group.status,
      } as TaskGroupStatus;
    });
  }

  async getTaskGroupResults(
    taskGroupId: string,
    includeOutput: boolean = true,
  ): Promise<TaskGroupResults> {
    return await this.invoke(async () => {
      const stream = await this.sdk.taskGroup.getRuns(taskGroupId, {
        include_output: includeOutput,
      });
      const runs: TaskGroupResults = [];
      for await (const event of stream) {
        const ev = event as { type?: string; run?: TaskRun; output?: unknown };
        if (ev.type === "task_run.state" && ev.run) {
          runs.push({
            run_id: ev.run.run_id,
            status: ev.run.status,
            ...(ev.output ? { output: ev.output as TaskGroupResults[number]["output"] } : {}),
          });
        }
      }
      return runs;
    });
  }

  private async invoke<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Parallel.APIError) {
        throw new ParallelApiError(
          `Parallel API ${err.status ?? "?"}: ${err.name}`,
          err.status ?? 0,
          (err as { message?: string }).message ?? "",
        );
      }
      throw err;
    }
  }
}
