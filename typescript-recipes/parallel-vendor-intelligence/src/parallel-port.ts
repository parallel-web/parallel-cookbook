/**
 * The recipe-owned portion of the Parallel API contract.
 *
 * Keep generated SDK types behind the adapter. Besides making orchestration
 * tests small, this avoids coupling the recipe to resource-class declarations
 * that happen to share names with API response objects.
 */

export interface JsonSchema {
  type: "json";
  json_schema: Record<string, unknown>;
}

export interface Citation {
  url: string;
  excerpts?: string[] | null;
  title?: string | null;
}

export interface FieldBasis {
  field: string;
  reasoning: string;
  citations?: Citation[];
  confidence?: string | null;
}

export interface Warning {
  message: string;
}

export interface TaskRunError {
  message: string;
  ref_id?: string;
}

export type TaskRunStatus =
  | "queued"
  | "action_required"
  | "running"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled";

export interface TaskRun {
  run_id: string;
  interaction_id: string;
  status: TaskRunStatus;
  error?: TaskRunError | null;
  warnings?: Warning[] | null;
}

export interface TaskRunJsonOutput {
  type: "json";
  content: unknown;
  basis: unknown;
}

export interface TaskRunTextOutput {
  type: "text";
  content: unknown;
  basis: unknown;
}

export type TaskRunOutput = TaskRunJsonOutput | TaskRunTextOutput;

export interface TaskRunResult {
  run: TaskRun;
  output: TaskRunOutput;
}

export interface TaskRunCreateParams {
  input: Record<string, unknown>;
  processor: string;
  task_spec: {
    output_schema: JsonSchema;
    input_schema?: JsonSchema;
  };
  metadata: Record<string, string | number | boolean>;
  previous_interaction_id?: string;
}

export interface TaskRunResultParams {
  timeout?: number;
}

export interface RequestOptions {
  maxRetries?: number;
  timeout?: number;
}

interface MonitorBase {
  monitor_id: string;
  status: "active" | "cancelled";
  processor: "lite" | "base";
  frequency: string;
  created_at: string;
  metadata?: Record<string, string> | null;
}

export interface SnapshotMonitor extends MonitorBase {
  type: "snapshot";
  settings: {
    task_run_id: string;
    query?: string;
  };
}

export interface EventStreamMonitor extends MonitorBase {
  type: "event_stream";
  settings: {
    query: string;
  };
}

export type Monitor = SnapshotMonitor | EventStreamMonitor;

export interface MonitorCreateParams {
  type: "snapshot";
  frequency: string;
  processor: "lite" | "base";
  settings: {
    task_run_id: string;
  };
  metadata: Record<string, string>;
}

export interface MonitorListParams {
  cursor?: string;
  limit?: number;
  status?: Array<"active" | "cancelled">;
  type?: Array<"event_stream" | "snapshot">;
}

export interface MonitorEventsParams {
  cursor?: string;
  event_group_id?: string;
  include_completions?: boolean;
  limit?: number;
}

export interface MonitorSnapshotEvent {
  event_id: string;
  event_group_id: string;
  event_date: string | null;
  previous_output: TaskRunOutput;
  changed_output: TaskRunOutput;
  event_type?: "snapshot";
}

export interface MonitorEventStreamEvent {
  event_id: string;
  event_group_id: string;
  event_date: string | null;
  output: TaskRunOutput;
  event_type?: "event_stream";
}

export interface MonitorCompletionEvent {
  timestamp: string;
  event_type?: "completion";
}

export interface MonitorErrorEvent {
  error_message: string;
  timestamp: string;
  event_type?: "error";
}

export type MonitorEvent =
  | MonitorSnapshotEvent
  | MonitorEventStreamEvent
  | MonitorCompletionEvent
  | MonitorErrorEvent;

export interface PaginatedMonitorEvents {
  events: MonitorEvent[];
  next_cursor?: string | null;
  warnings?: Warning[] | null;
}

export interface PaginatedMonitorResponse {
  monitors: Monitor[];
  next_cursor?: string | null;
}

export interface ParallelPort {
  taskRun: {
    create(params: TaskRunCreateParams, options?: RequestOptions): Promise<TaskRun>;
    retrieve(runId: string): Promise<TaskRun>;
    result(
      runId: string,
      params?: TaskRunResultParams | null,
      options?: RequestOptions,
    ): Promise<TaskRunResult>;
  };
  monitor: {
    create(params: MonitorCreateParams, options?: RequestOptions): Promise<SnapshotMonitor>;
    retrieve(monitorId: string): Promise<Monitor>;
    list(params?: MonitorListParams | null): Promise<PaginatedMonitorResponse>;
    events(
      monitorId: string,
      params?: MonitorEventsParams | null,
    ): Promise<PaginatedMonitorEvents>;
    cancel(monitorId: string): Promise<Monitor>;
  };
}
