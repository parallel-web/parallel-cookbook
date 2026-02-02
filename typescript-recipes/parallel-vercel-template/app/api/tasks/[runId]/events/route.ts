import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  if (!runId) {
    return new Response("runId is required", { status: 400 });
  }

  if (!process.env.PARALLEL_API_KEY) {
    return new Response("PARALLEL_API_KEY is not configured", { status: 500 });
  }

  const eventsUrl = `https://api.parallel.ai/v1beta/tasks/runs/${runId}/events`;

  try {
    const response = await fetch(eventsUrl, {
      method: "GET",
      headers: {
        "x-api-key": process.env.PARALLEL_API_KEY,
        "parallel-beta": "events-sse-2025-07-24",
        Accept: "text/event-stream",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(`Parallel API error: ${errorText}`, {
        status: response.status,
      });
    }

    // Stream the response through
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("SSE proxy error:", error);
    return new Response(
      error instanceof Error ? error.message : "SSE connection failed",
      { status: 500 }
    );
  }
}
