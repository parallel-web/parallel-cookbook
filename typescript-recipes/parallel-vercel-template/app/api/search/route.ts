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

    if (!objective) {
      return errorResponse("objective is required", 400);
    }

    const client = getParallelClient();

    const searchResult = await client.beta.search({
      objective,
      search_queries: searchQueries || undefined,
      mode: mode || "one-shot",
      max_results: maxResults || SEARCH_DEFAULTS.MAX_RESULTS,
      max_chars_per_result: SEARCH_DEFAULTS.MAX_CHARS_PER_RESULT,
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
