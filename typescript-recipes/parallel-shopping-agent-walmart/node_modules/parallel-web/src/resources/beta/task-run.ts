// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as BetaTaskRunAPI from './task-run';
import * as Shared from '../shared';
import * as TaskRunAPI from '../task-run';
import { APIPromise } from '../../core/api-promise';
import { Stream } from '../../core/streaming';
import { buildHeaders } from '../../internal/headers';
import { RequestOptions } from '../../internal/request-options';
import { path } from '../../internal/utils/path';

export class TaskRun extends APIResource {
  /**
   * Initiates a task run.
   *
   * Returns immediately with a run object in status 'queued'.
   *
   * Beta features can be enabled by setting the 'parallel-beta' header.
   */
  create(params: TaskRunCreateParams, options?: RequestOptions): APIPromise<TaskRunAPI.TaskRun> {
    const { betas, ...body } = params;
    return this._client.post('/v1/tasks/runs?beta=true', {
      body,
      ...options,
      headers: buildHeaders([
        { ...(betas?.toString() != null ? { 'parallel-beta': betas?.toString() } : undefined) },
        options?.headers,
      ]),
    });
  }

  /**
   * Streams events for a task run.
   *
   * Returns a stream of events showing progress updates and state changes for the
   * task run.
   *
   * For task runs that did not have enable_events set to true during creation, the
   * frequency of events will be reduced.
   */
  events(runID: string, options?: RequestOptions): APIPromise<Stream<TaskRunEventsResponse>> {
    return this._client.get(path`/v1beta/tasks/runs/${runID}/events`, {
      ...options,
      headers: buildHeaders([{ Accept: 'text/event-stream' }, options?.headers]),
      stream: true,
    }) as APIPromise<Stream<TaskRunEventsResponse>>;
  }

  /**
   * Retrieves a run result by run_id, blocking until the run is completed.
   */
  result(
    runID: string,
    params: TaskRunResultParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<BetaTaskRunResult> {
    const { betas, ...query } = params ?? {};
    return this._client.get(path`/v1/tasks/runs/${runID}/result?beta=true`, {
      query,
      ...options,
      headers: buildHeaders([
        { ...(betas?.toString() != null ? { 'parallel-beta': betas?.toString() } : undefined) },
        options?.headers,
      ]),
    });
  }
}

/**
 * Task run input with additional beta fields.
 */
export interface BetaRunInput {
  /**
   * Input to the task, either text or a JSON object.
   */
  input: string | { [key: string]: unknown };

  /**
   * Processor to use for the task.
   */
  processor: string;

  /**
   * Controls tracking of task run execution progress. When set to true, progress
   * events are recorded and can be accessed via the
   * [Task Run events](https://platform.parallel.ai/api-reference) endpoint. When
   * false, no progress events are tracked. Note that progress tracking cannot be
   * enabled after a run has been created. The flag is set to true by default for
   * premium processors (pro and above). To enable this feature in your requests,
   * specify `events-sse-2025-07-24` as one of the values in `parallel-beta` header
   * (for API calls) or `betas` param (for the SDKs).
   */
  enable_events?: boolean | null;

  /**
   * Optional list of MCP servers to use for the run. To enable this feature in your
   * requests, specify `mcp-server-2025-07-17` as one of the values in
   * `parallel-beta` header (for API calls) or `betas` param (for the SDKs).
   */
  mcp_servers?: Array<McpServer> | null;

  /**
   * User-provided metadata stored with the run. Keys and values must be strings with
   * a maximum length of 16 and 512 characters respectively.
   */
  metadata?: { [key: string]: string | number | boolean } | null;

  /**
   * Source policy for web search results.
   *
   * This policy governs which sources are allowed/disallowed in results.
   */
  source_policy?: Shared.SourcePolicy | null;

  /**
   * Specification for a task.
   *
   * Auto output schemas can be specified by setting `output_schema={"type":"auto"}`.
   * Not specifying a TaskSpec is the same as setting an auto output schema.
   *
   * For convenience bare strings are also accepted as input or output schemas.
   */
  task_spec?: TaskRunAPI.TaskSpec | null;

  /**
   * Webhooks for Task Runs.
   */
  webhook?: Webhook | null;
}

/**
 * Result of a beta task run. Available only if beta headers are specified.
 */
export interface BetaTaskRunResult {
  /**
   * Output from the task conforming to the output schema.
   */
  output: BetaTaskRunResult.BetaTaskRunTextOutput | BetaTaskRunResult.BetaTaskRunJsonOutput;

  /**
   * Status of a task run.
   */
  run: TaskRunAPI.TaskRun;
}

export namespace BetaTaskRunResult {
  /**
   * Output from a task that returns text.
   */
  export interface BetaTaskRunTextOutput {
    /**
     * Basis for the output.
     */
    basis: Array<TaskRunAPI.FieldBasis>;

    /**
     * Text output from the task.
     */
    content: string;

    /**
     * The type of output being returned, as determined by the output schema of the
     * task spec.
     */
    type: 'text';

    /**
     * Always None.
     */
    beta_fields?: { [key: string]: unknown } | null;

    /**
     * MCP tool calls made by the task.
     */
    mcp_tool_calls?: Array<BetaTaskRunAPI.McpToolCall> | null;
  }

  /**
   * Output from a task that returns JSON.
   */
  export interface BetaTaskRunJsonOutput {
    /**
     * Basis for the output.
     */
    basis: Array<TaskRunAPI.FieldBasis>;

    /**
     * Output from the task as a native JSON object, as determined by the output schema
     * of the task spec.
     */
    content: { [key: string]: unknown };

    /**
     * The type of output being returned, as determined by the output schema of the
     * task spec.
     */
    type: 'json';

    /**
     * Always None.
     */
    beta_fields?: { [key: string]: unknown } | null;

    /**
     * MCP tool calls made by the task.
     */
    mcp_tool_calls?: Array<BetaTaskRunAPI.McpToolCall> | null;

    /**
     * Output schema for the Task Run. Populated only if the task was executed with an
     * auto schema.
     */
    output_schema?: { [key: string]: unknown } | null;
  }
}

/**
 * Event indicating an error.
 */
export interface ErrorEvent {
  /**
   * An error message.
   */
  error: Shared.ErrorObject;

  /**
   * Event type; always 'error'.
   */
  type: 'error';
}

/**
 * MCP server configuration.
 */
export interface McpServer {
  /**
   * Name of the MCP server.
   */
  name: string;

  /**
   * URL of the MCP server.
   */
  url: string;

  /**
   * List of allowed tools for the MCP server.
   */
  allowed_tools?: Array<string> | null;

  /**
   * Headers for the MCP server.
   */
  headers?: { [key: string]: string } | null;

  /**
   * Type of MCP server being configured. Always `url`.
   */
  type?: 'url';
}

/**
 * Result of an MCP tool call.
 */
export interface McpToolCall {
  /**
   * Arguments used to call the MCP tool.
   */
  arguments: string;

  /**
   * Name of the MCP server.
   */
  server_name: string;

  /**
   * Identifier for the tool call.
   */
  tool_call_id: string;

  /**
   * Name of the tool being called.
   */
  tool_name: string;

  /**
   * Output received from the tool call, if successful.
   */
  content?: string | null;

  /**
   * Error message if the tool call failed.
   */
  error?: string | null;
}

/**
 * Model for the parallel-beta header.
 */
export type ParallelBeta =
  | 'mcp-server-2025-07-17'
  | 'events-sse-2025-07-24'
  | 'webhook-2025-08-12'
  | (string & {});

/**
 * Event when a task run transitions to a non-active status.
 *
 * May indicate completion, cancellation, or failure.
 */
export interface TaskRunEvent {
  /**
   * Cursor to resume the event stream. Always empty for non Task Group runs.
   */
  event_id: string | null;

  /**
   * Status of a task run.
   */
  run: TaskRunAPI.TaskRun;

  /**
   * Event type; always 'task_run.state'.
   */
  type: 'task_run.state';

  /**
   * Task run input with additional beta fields.
   */
  input?: BetaRunInput | null;

  /**
   * Output from the run; included only if requested and if status == `completed`.
   */
  output?: TaskRunAPI.TaskRunTextOutput | TaskRunAPI.TaskRunJsonOutput | null;
}

/**
 * Webhooks for Task Runs.
 */
export interface Webhook {
  /**
   * URL for the webhook.
   */
  url: string;

  /**
   * Event types to send the webhook notifications for.
   */
  event_types?: Array<'task_run.status'>;
}

/**
 * A progress update for a task run.
 */
export type TaskRunEventsResponse =
  | TaskRunEventsResponse.TaskRunProgressStatsEvent
  | TaskRunEventsResponse.TaskRunProgressMessageEvent
  | TaskRunEvent
  | ErrorEvent;

export namespace TaskRunEventsResponse {
  /**
   * A progress update for a task run.
   */
  export interface TaskRunProgressStatsEvent {
    /**
     * Completion percentage of the task run. Ranges from 0 to 100 where 0 indicates no
     * progress and 100 indicates completion.
     */
    progress_meter: number;

    /**
     * Source stats for a task run.
     */
    source_stats: TaskRunProgressStatsEvent.SourceStats;

    /**
     * Event type; always 'task_run.progress_stats'.
     */
    type: 'task_run.progress_stats';
  }

  export namespace TaskRunProgressStatsEvent {
    /**
     * Source stats for a task run.
     */
    export interface SourceStats {
      /**
       * Number of sources considered in processing the task.
       */
      num_sources_considered: number | null;

      /**
       * Number of sources read in processing the task.
       */
      num_sources_read: number | null;

      /**
       * A sample of URLs of sources read in processing the task.
       */
      sources_read_sample: Array<string> | null;
    }
  }

  /**
   * A message for a task run progress update.
   */
  export interface TaskRunProgressMessageEvent {
    /**
     * Progress update message.
     */
    message: string;

    /**
     * Timestamp of the message.
     */
    timestamp: string | null;

    /**
     * Event type; always starts with 'task_run.progress_msg'.
     */
    type:
      | 'task_run.progress_msg.plan'
      | 'task_run.progress_msg.search'
      | 'task_run.progress_msg.result'
      | 'task_run.progress_msg.tool_call'
      | 'task_run.progress_msg.exec_status';
  }
}

export interface TaskRunCreateParams {
  /**
   * Body param: Input to the task, either text or a JSON object.
   */
  input: string | { [key: string]: unknown };

  /**
   * Body param: Processor to use for the task.
   */
  processor: string;

  /**
   * Body param: Controls tracking of task run execution progress. When set to true,
   * progress events are recorded and can be accessed via the
   * [Task Run events](https://platform.parallel.ai/api-reference) endpoint. When
   * false, no progress events are tracked. Note that progress tracking cannot be
   * enabled after a run has been created. The flag is set to true by default for
   * premium processors (pro and above). To enable this feature in your requests,
   * specify `events-sse-2025-07-24` as one of the values in `parallel-beta` header
   * (for API calls) or `betas` param (for the SDKs).
   */
  enable_events?: boolean | null;

  /**
   * Body param: Optional list of MCP servers to use for the run. To enable this
   * feature in your requests, specify `mcp-server-2025-07-17` as one of the values
   * in `parallel-beta` header (for API calls) or `betas` param (for the SDKs).
   */
  mcp_servers?: Array<McpServer> | null;

  /**
   * Body param: User-provided metadata stored with the run. Keys and values must be
   * strings with a maximum length of 16 and 512 characters respectively.
   */
  metadata?: { [key: string]: string | number | boolean } | null;

  /**
   * Body param: Source policy for web search results.
   *
   * This policy governs which sources are allowed/disallowed in results.
   */
  source_policy?: Shared.SourcePolicy | null;

  /**
   * Body param: Specification for a task.
   *
   * Auto output schemas can be specified by setting `output_schema={"type":"auto"}`.
   * Not specifying a TaskSpec is the same as setting an auto output schema.
   *
   * For convenience bare strings are also accepted as input or output schemas.
   */
  task_spec?: TaskRunAPI.TaskSpec | null;

  /**
   * Body param: Webhooks for Task Runs.
   */
  webhook?: Webhook | null;

  /**
   * Header param: Optional header to specify the beta version(s) to enable.
   */
  betas?: Array<ParallelBeta>;
}

export interface TaskRunResultParams {
  /**
   * Query param:
   */
  timeout?: number;

  /**
   * Header param: Optional header to specify the beta version(s) to enable.
   */
  betas?: Array<ParallelBeta>;
}

export declare namespace TaskRun {
  export {
    type BetaRunInput as BetaRunInput,
    type BetaTaskRunResult as BetaTaskRunResult,
    type ErrorEvent as ErrorEvent,
    type McpServer as McpServer,
    type McpToolCall as McpToolCall,
    type ParallelBeta as ParallelBeta,
    type TaskRunEvent as TaskRunEvent,
    type Webhook as Webhook,
    type TaskRunEventsResponse as TaskRunEventsResponse,
    type TaskRunCreateParams as TaskRunCreateParams,
    type TaskRunResultParams as TaskRunResultParams,
  };
}
