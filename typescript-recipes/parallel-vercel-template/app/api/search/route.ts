import { NextRequest, NextResponse } from "next/server";
import {
  getParallelClient,
  ParallelConfigError,
  errorResponse,
  SEARCH_DEFAULTS,
} from "@/lib/parallel";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { objective, searchQueries, mode, maxResults } = body;

    if (typeof objective !== "string" || !objective.trim()) {
      return errorResponse("objective is required", 400);
    }

    if (
      searchQueries !== undefined &&
      (!Array.isArray(searchQueries) ||
        searchQueries.some((query: unknown) => typeof query !== "string"))
    ) {
      return errorResponse("searchQueries must be an array of strings", 400);
    }

    const searchMode = mode || "basic";
    if (!["turbo", "fast", "basic", "advanced"].includes(searchMode)) {
      return errorResponse("Unsupported search mode", 400);
    }
    const queries = (searchQueries ?? [])
      .map((query: string) => query.trim())
      .filter(Boolean);
    const client = getParallelClient();

    const searchResult = await client.search({
      objective,
      // Keep objective-only submissions working with v1's required queries.
      search_queries: queries.length ? queries : [objective.trim()],
      mode: searchMode,
      advanced_settings: {
        max_results: maxResults || SEARCH_DEFAULTS.MAX_RESULTS,
        excerpt_settings: {
          max_chars_per_result: SEARCH_DEFAULTS.MAX_CHARS_PER_RESULT,
        },
      },
    });

    return NextResponse.json(searchResult);
  } catch (error) {
    if (error instanceof ParallelConfigError) {
      return errorResponse(error.message, 500);
    }
    console.error("Search API error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Search failed",
      500
    );
  }
}
