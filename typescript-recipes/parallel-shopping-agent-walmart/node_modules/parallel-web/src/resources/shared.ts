// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

/**
 * An error message.
 */
export interface ErrorObject {
  /**
   * Human-readable message.
   */
  message: string;

  /**
   * Reference ID for the error.
   */
  ref_id: string;

  /**
   * Optional detail supporting the error.
   */
  detail?: { [key: string]: unknown } | null;
}

/**
 * Response object used for non-200 status codes.
 */
export interface ErrorResponse {
  /**
   * An error message.
   */
  error: ErrorObject;

  /**
   * Always 'error'.
   */
  type: 'error';
}

/**
 * Source policy for web search results.
 *
 * This policy governs which sources are allowed/disallowed in results.
 */
export interface SourcePolicy {
  /**
   * List of domains to exclude from results. If specified, sources from these
   * domains will be excluded.
   */
  exclude_domains?: Array<string>;

  /**
   * List of domains to restrict the results to. If specified, only sources from
   * these domains will be included.
   */
  include_domains?: Array<string>;
}

/**
 * Human-readable message for a task.
 */
export interface Warning {
  /**
   * Human-readable message.
   */
  message: string;

  /**
   * Type of warning. Note that adding new warning types is considered a
   * backward-compatible change.
   */
  type: 'spec_validation_warning' | 'input_validation_warning' | 'warning';

  /**
   * Optional detail supporting the warning.
   */
  detail?: { [key: string]: unknown } | null;
}
