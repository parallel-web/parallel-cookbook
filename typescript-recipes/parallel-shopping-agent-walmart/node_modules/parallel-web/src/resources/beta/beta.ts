// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as Shared from '../shared';
import * as TaskGroupAPI from './task-group';
import {
  TaskGroup,
  TaskGroupAddRunsParams,
  TaskGroupCreateParams,
  TaskGroupEventsParams,
  TaskGroupEventsResponse,
  TaskGroupGetRunsParams,
  TaskGroupGetRunsResponse,
  TaskGroupRunResponse,
  TaskGroupStatus,
} from './task-group';
import * as TaskRunAPI from './task-run';
import {
  BetaRunInput,
  BetaTaskRunResult,
  ErrorEvent,
  McpServer,
  McpToolCall,
  ParallelBeta,
  TaskRun,
  TaskRunCreateParams,
  TaskRunEvent,
  TaskRunEventsResponse,
  TaskRunResultParams,
  Webhook,
} from './task-run';
import { APIPromise } from '../../core/api-promise';
import { RequestOptions } from '../../internal/request-options';

export class Beta extends APIResource {
  taskRun: TaskRunAPI.TaskRun = new TaskRunAPI.TaskRun(this._client);
  taskGroup: TaskGroupAPI.TaskGroup = new TaskGroupAPI.TaskGroup(this._client);

  /**
   * Searches the web.
   */
  search(body: BetaSearchParams, options?: RequestOptions): APIPromise<SearchResult> {
    return this._client.post('/v1beta/search', { body, ...options });
  }
}

/**
 * Output for the Search API.
 */
export interface SearchResult {
  /**
   * A list of WebSearchResult objects, ordered by decreasing relevance.
   */
  results: Array<WebSearchResult>;

  /**
   * Search ID. Example: `search_cad0a6d2dec046bd95ae900527d880e7`
   */
  search_id: string;
}

/**
 * A single search result from the web search API.
 */
export interface WebSearchResult {
  /**
   * Text excerpts from the search result which are relevant to the request.
   */
  excerpts: Array<string>;

  /**
   * Title of the search result.
   */
  title: string;

  /**
   * URL associated with the search result.
   */
  url: string;
}

export interface BetaSearchParams {
  /**
   * Upper bound on the number of characters to include in excerpts for each search
   * result.
   */
  max_chars_per_result?: number | null;

  /**
   * Upper bound on the number of results to return. May be limited by the processor.
   * Defaults to 10 if not provided.
   */
  max_results?: number | null;

  /**
   * Natural-language description of what the web search is trying to find. May
   * include guidance about preferred sources or freshness. At least one of objective
   * or search_queries must be provided.
   */
  objective?: string | null;

  /**
   * Search processor.
   */
  processor?: 'base' | 'pro';

  /**
   * Optional list of traditional keyword search queries to guide the search. May
   * contain search operators. At least one of objective or search_queries must be
   * provided.
   */
  search_queries?: Array<string> | null;

  /**
   * Source policy for web search results.
   *
   * This policy governs which sources are allowed/disallowed in results.
   */
  source_policy?: Shared.SourcePolicy | null;
}

Beta.TaskRun = TaskRun;

export declare namespace Beta {
  export {
    type SearchResult as SearchResult,
    type WebSearchResult as WebSearchResult,
    type BetaSearchParams as BetaSearchParams,
  };

  export {
    TaskRun as TaskRun,
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

  export {
    type TaskGroup as TaskGroup,
    type TaskGroupRunResponse as TaskGroupRunResponse,
    type TaskGroupStatus as TaskGroupStatus,
    type TaskGroupEventsResponse as TaskGroupEventsResponse,
    type TaskGroupGetRunsResponse as TaskGroupGetRunsResponse,
    type TaskGroupCreateParams as TaskGroupCreateParams,
    type TaskGroupAddRunsParams as TaskGroupAddRunsParams,
    type TaskGroupEventsParams as TaskGroupEventsParams,
    type TaskGroupGetRunsParams as TaskGroupGetRunsParams,
  };
}
