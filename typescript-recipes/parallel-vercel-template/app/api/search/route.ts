import { NextRequest, NextResponse } from "next/server";
import Parallel from "parallel-web";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { objective, searchQueries, mode, maxResults } = body;

    if (!objective) {
      return NextResponse.json(
        { error: "objective is required" },
        { status: 400 }
      );
    }

    if (!process.env.PARALLEL_API_KEY) {
      return NextResponse.json(
        { error: "PARALLEL_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const client = new Parallel({
      apiKey: process.env.PARALLEL_API_KEY,
    });

    const searchResult = await client.beta.search({
      objective,
      search_queries: searchQueries || undefined,
      mode: mode || "one-shot",
      max_results: maxResults || 10,
      max_chars_per_result: 2500,
    });

    return NextResponse.json(searchResult);
  } catch (error) {
    console.error("Search API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}
