import { z } from "zod";

// ── Error Classes ──────────────────────────────────────────────────────────

export class ParallelApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string = "") {
    super(message);
    this.name = "ParallelApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class RunNotCompleteError extends Error {
  public readonly runId: string;
  public readonly currentStatus: string;

  constructor(runId: string, currentStatus: string) {
    super(
      `Run ${runId} is not complete (current status: ${currentStatus})`
    );
    this.name = "RunNotCompleteError";
    this.runId = runId;
    this.currentStatus = currentStatus;
  }
}

export class TaskGroupTimeoutError extends Error {
  public readonly taskGroupId: string;
  public readonly elapsedMs: number;

  constructor(taskGroupId: string, elapsedMs: number) {
    super(
      `Task group ${taskGroupId} timed out after ${Math.round(elapsedMs / 1000)}s`
    );
    this.name = "TaskGroupTimeoutError";
    this.taskGroupId = taskGroupId;
    this.elapsedMs = elapsedMs;
  }
}

// ── Enums ──────────────────────────────────────────────────────────────────

export const TaskRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

// ── Webhook Config ─────────────────────────────────────────────────────────

export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).default(["task_run.status"]),
});

// ── Task Run Schemas ───────────────────────────────────────────────────────

export const TaskRunSchema = z
  .object({
    run_id: z.string(),
    status: TaskRunStatusSchema,
    is_active: z.boolean().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const BasisCitationSchema = z.object({
  url: z.string(),
  title: z.string().nullish(),
  excerpts: z.array(z.string()).nullish(),
});

export const BasisEntrySchema = z.object({
  field: z.string(),
  reasoning: z.string().nullish(),
  citations: z.array(BasisCitationSchema).optional(),
  confidence: z.string().nullish(),
});

export const TaskRunOutputSchema = z.object({
  type: z.enum(["text", "json"]),
  content: z.union([z.string(), z.record(z.unknown())]),
  basis: z.array(BasisEntrySchema).optional(),
});

export const TaskRunResultSchema = z
  .object({
    output: TaskRunOutputSchema,
  })
  .passthrough();

// ── Task Run Input ─────────────────────────────────────────────────────────

export const TaskRunInputSchema = z.object({
  input: z.union([z.string(), z.record(z.unknown())]),
  processor: z.string().optional(),
});

// ── Task Group Schemas ─────────────────────────────────────────────────────

export const TaskGroupSchema = z
  .object({
    taskgroup_id: z.string(),
  })
  .passthrough();

export const TaskGroupStatusSchema = z
  .object({
    taskgroup_id: z.string(),
    status: z.object({
      is_active: z.boolean(),
      num_task_runs: z.number(),
      task_run_status_counts: z.record(z.number()).default({}),
    }),
  })
  .passthrough();

export const TaskGroupRunSchema = z
  .object({
    run_id: z.string(),
    status: TaskRunStatusSchema,
    output: TaskRunOutputSchema.optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const TaskGroupResultsSchema = z.array(TaskGroupRunSchema);

// ── Derived TypeScript Types ───────────────────────────────────────────────

export type TaskRunStatus = z.infer<typeof TaskRunStatusSchema>;
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;
export type TaskRun = z.infer<typeof TaskRunSchema>;
export type BasisCitation = z.infer<typeof BasisCitationSchema>;
export type BasisEntry = z.infer<typeof BasisEntrySchema>;
export type TaskRunOutput = z.infer<typeof TaskRunOutputSchema>;
export type TaskRunResult = z.infer<typeof TaskRunResultSchema>;
export type TaskRunInput = z.infer<typeof TaskRunInputSchema>;
export type TaskGroup = z.infer<typeof TaskGroupSchema>;
export type TaskGroupStatus = z.infer<typeof TaskGroupStatusSchema>;
export type TaskGroupRun = z.infer<typeof TaskGroupRunSchema>;
export type TaskGroupResults = z.infer<typeof TaskGroupResultsSchema>;

// ── Request Parameter Types ────────────────────────────────────────────────

export interface OutputSchema {
  type: "text" | "json";
  json_schema?: Record<string, unknown>;
}

export interface CreateRunParams {
  input: string | Record<string, unknown>;
  processor?: string;
  outputSchema?: OutputSchema;
  webhook?: WebhookConfig;
}
