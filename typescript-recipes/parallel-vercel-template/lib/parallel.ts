import Parallel from "parallel-web";
import { NextResponse } from "next/server";

/**
 * Get a configured Parallel client instance.
 * Throws an error if PARALLEL_API_KEY is not configured.
 */
export function getParallelClient(): Parallel {
  if (!process.env.PARALLEL_API_KEY) {
    throw new ParallelConfigError("PARALLEL_API_KEY is not configured");
  }
  return new Parallel({ apiKey: process.env.PARALLEL_API_KEY });
}

/**
 * Custom error class for Parallel configuration errors.
 * Used to distinguish config errors from runtime errors.
 */
export class ParallelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParallelConfigError";
  }
}

/**
 * Create a JSON error response with consistent format.
 */
export function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// Task processing constants
export const TASK_DEFAULTS = {
  DEFAULT_PROCESSOR: "lite",
  PROCESSORS_WITH_AUTO_SCHEMA: ["pro", "ultra"],
} as const;

// Search API constants
export const SEARCH_DEFAULTS = {
  MAX_CHARS_PER_RESULT: 2500,
  MAX_RESULTS: 10,
} as const;

/**
 * Parse task output from various formats into a string.
 * Handles string, object with content, and raw object formats.
 */
export function parseTaskOutput(rawOutput: unknown): string | null {
  if (!rawOutput) return null;
  if (typeof rawOutput === "string") return rawOutput;
  if (typeof rawOutput === "object" && rawOutput !== null) {
    const output = rawOutput as { content?: unknown };
    if (typeof output.content === "string") return output.content;
    return JSON.stringify(output.content ?? rawOutput, null, 2);
  }
  return JSON.stringify(rawOutput, null, 2);
}
