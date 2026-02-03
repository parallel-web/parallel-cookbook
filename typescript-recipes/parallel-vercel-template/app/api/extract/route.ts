import { NextRequest, NextResponse } from "next/server";
import {
  getParallelClient,
  ParallelConfigError,
  errorResponse,
} from "@/lib/parallel";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls, objective } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return errorResponse("urls array is required", 400);
    }

    const client = getParallelClient();

    const extractResult = await client.beta.extract({
      urls,
      objective: objective?.trim() || undefined,
      excerpts: true,
      full_content: false,
    });

    return NextResponse.json(extractResult);
  } catch (error) {
    if (error instanceof ParallelConfigError) {
      return errorResponse(error.message, 500);
    }
    console.error("Extract API error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Extract failed",
      500
    );
  }
}
