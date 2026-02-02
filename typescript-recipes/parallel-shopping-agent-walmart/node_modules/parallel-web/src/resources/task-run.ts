// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import * as Shared from './shared';
import { APIPromise } from '../core/api-promise';
import { RequestOptions } from '../internal/request-options';
import { path } from '../internal/utils/path';

export class TaskRun extends APIResource {
  /**
   * Initiates a task run.
   *
   * Returns immediately with a run object in status 'queued'.
   *
   * Beta features can be enabled by setting the 'parallel-beta' header.
   */
  create(body: TaskRunCreateParams, options?: RequestOptions): APIPromise<TaskRun> {
    return this._client.post('/v1/tasks/runs', { body, ...options });
  }

  /**
   * Retrieves run status by run_id.
   *
   * The run result is available from the `/result` endpoint.
   */
  retrieve(runID: string, options?: RequestOptions): APIPromise<TaskRun> {
    return this._client.get(path`/v1/tasks/runs/${runID}`, options);
  }

  /**
   * Retrieves a run result by run_id, blocking until the run is completed.
   */
  result(
    runID: string,
    query: TaskRunResultParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<TaskRunResult> {
    return this._client.get(path`/v1/tasks/runs/${runID}/result`, { query, ...options });
  }
}

/**
 * Auto schema for a task input or output.
 */
export interface AutoSchema {
  /**
   * The type of schema being defined. Always `auto`.
   */
  type?: 'auto';
}

/**
 * A citation for a task output.
 */
export interface Citation {
  /**
   * URL of the citation.
   */
  url: string;

  /**
   * Excerpts from the citation supporting the output. Only certain processors
   * provide excerpts.
   */
  excerpts?: Array<string> | null;

  /**
   * Title of the citation.
   */
  title?: string | null;
}

/**
 * Citations and reasoning supporting one field of a task output.
 */
export interface FieldBasis {
  /**
   * Name of the output field.
   */
  field: string;

  /**
   * Reasoning for the output field.
   */
  reasoning: string;

  /**
   * List of citations supporting the output field.
   */
  citations?: Array<Citation>;

  /**
   * Confidence level for the output field. Only certain processors provide
   * confidence levels.
   */
  confidence?: string | null;
}

/**
 * JSON schema for a task input or output.
 */
export interface JsonSchema {
  /**
   * A JSON Schema object. Only a subset of JSON Schema is supported.
   */
  json_schema: { [key: string]: unknown };

  /**
   * The type of schema being defined. Always `json`.
   */
  type?: 'json';
}

/**
 * Request to run a task.
 */
export interface RunInput {
  /**
   * Input to the task, either text or a JSON object.
   */
  input: string | { [key: string]: unknown };

  /**
   * Processor to use for the task.
   */
  processor: string;

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
  task_spec?: TaskSpec | null;
}

/**
 * Status of a task run.
 */
export interface TaskRun {
  /**
   * Timestamp of the creation of the task, as an RFC 3339 string.
   */
  created_at: string | null;

  /**
   * Whether the run is currently active, i.e. status is one of {'cancelling',
   * 'queued', 'running'}.
   */
  is_active: boolean;

  /**
   * Timestamp of the last modification to the task, as an RFC 3339 string.
   */
  modified_at: string | null;

  /**
   * Processor used for the run.
   */
  processor: string;

  /**
   * ID of the task run.
   */
  run_id: string;

  /**
   * Status of the run.
   */
  status: 'queued' | 'action_required' | 'running' | 'completed' | 'failed' | 'cancelling' | 'cancelled';

  /**
   * An error message.
   */
  error?: Shared.ErrorObject | null;

  /**
   * User-provided metadata stored with the run.
   */
  metadata?: { [key: string]: string | number | boolean } | null;

  /**
   * ID of the taskgroup to which the run belongs.
   */
  taskgroup_id?: string | null;

  /**
   * Warnings for the run, if any.
   */
  warnings?: Array<Shared.Warning> | null;
}

/**
 * Output from a task that returns JSON.
 */
export interface TaskRunJsonOutput {
  /**
   * Basis for each top-level field in the JSON output.
   */
  basis: Array<FieldBasis>;

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
   * Additional fields from beta features used in this task run. When beta features
   * are specified during both task run creation and result retrieval, this field
   * will be empty and instead the relevant beta attributes will be directly included
   * in the `BetaTaskRunJsonOutput` or corresponding output type. However, if beta
   * features were specified during task run creation but not during result
   * retrieval, this field will contain the dump of fields from those beta features.
   * Each key represents the beta feature version (one amongst parallel-beta headers)
   * and the values correspond to the beta feature attributes, if any. For now, only
   * MCP server beta features have attributes. For example,
   * `{mcp-server-2025-07-17: [{'server_name':'mcp_server', 'tool_call_id': 'tc_123', ...}]}}`
   */
  beta_fields?: { [key: string]: unknown } | null;

  /**
   * Output schema for the Task Run. Populated only if the task was executed with an
   * auto schema.
   */
  output_schema?: { [key: string]: unknown } | null;
}

/**
 * Result of a task run.
 */
export interface TaskRunResult {
  /**
   * Output from the task conforming to the output schema.
   */
  output: TaskRunTextOutput | TaskRunJsonOutput;

  /**
   * Status of a task run.
   */
  run: TaskRun;
}

/**
 * Output from a task that returns text.
 */
export interface TaskRunTextOutput {
  /**
   * Basis for the output. The basis has a single field 'output'.
   */
  basis: Array<FieldBasis>;

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
   * Additional fields from beta features used in this task run. When beta features
   * are specified during both task run creation and result retrieval, this field
   * will be empty and instead the relevant beta attributes will be directly included
   * in the `BetaTaskRunJsonOutput` or corresponding output type. However, if beta
   * features were specified during task run creation but not during result
   * retrieval, this field will contain the dump of fields from those beta features.
   * Each key represents the beta feature version (one amongst parallel-beta headers)
   * and the values correspond to the beta feature attributes, if any. For now, only
   * MCP server beta features have attributes. For example,
   * `{mcp-server-2025-07-17: [{'server_name':'mcp_server', 'tool_call_id': 'tc_123', ...}]}}`
   */
  beta_fields?: { [key: string]: unknown } | null;
}

/**
 * Specification for a task.
 *
 * Auto output schemas can be specified by setting `output_schema={"type":"auto"}`.
 * Not specifying a TaskSpec is the same as setting an auto output schema.
 *
 * For convenience bare strings are also accepted as input or output schemas.
 */
export interface TaskSpec {
  /**
   * JSON schema or text fully describing the desired output from the task.
   * Descriptions of output fields will determine the form and content of the
   * response. A bare string is equivalent to a text schema with the same
   * description.
   */
  output_schema: JsonSchema | TextSchema | AutoSchema | string;

  /**
   * Optional JSON schema or text description of expected input to the task. A bare
   * string is equivalent to a text schema with the same description.
   */
  input_schema?: string | JsonSchema | TextSchema | null;
}

/**
 * Text description for a task input or output.
 */
export interface TextSchema {
  /**
   * A text description of the desired output from the task.
   */
  description?: string | null;

  /**
   * The type of schema being defined. Always `text`.
   */
  type?: 'text';
}

export interface TaskRunCreateParams {
  /**
   * Input to the task, either text or a JSON object.
   */
  input: string | { [key: string]: unknown };

  /**
   * Processor to use for the task.
   */
  processor: string;

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
  task_spec?: TaskSpec | null;
}

export interface TaskRunResultParams {
  timeout?: number;
}

export declare namespace TaskRun {
  export {
    type AutoSchema as AutoSchema,
    type Citation as Citation,
    type FieldBasis as FieldBasis,
    type JsonSchema as JsonSchema,
    type RunInput as RunInput,
    type TaskRun as TaskRun,
    type TaskRunJsonOutput as TaskRunJsonOutput,
    type TaskRunResult as TaskRunResult,
    type TaskRunTextOutput as TaskRunTextOutput,
    type TaskSpec as TaskSpec,
    type TextSchema as TextSchema,
    type TaskRunCreateParams as TaskRunCreateParams,
    type TaskRunResultParams as TaskRunResultParams,
  };
}
