import { NextRequest, NextResponse } from "next/server";
import Parallel from "parallel-web";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls, objective } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "urls array is required" },
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

    const extractResult = await client.beta.extract({
      urls,
      objective: objective || undefined,
      excerpts: true,
      full_content: false,
    });

    return NextResponse.json(extractResult);
  } catch (error) {
    console.error("Extract API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Extract failed" },
      { status: 500 }
    );
  }
}
