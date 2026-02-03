import { NextRequest } from "next/server";
import { getParallelClient, ParallelConfigError } from "@/lib/parallel";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  if (!runId) {
    return Response.json({ error: "runId is required" }, { status: 400 });
  }

  try {
    const client = getParallelClient();

    // Use the SDK's beta.taskRun.events() method to get the event stream
    const eventStream = await client.beta.taskRun.events(runId);

    // Create a ReadableStream that converts SDK events to SSE format
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          for await (const event of eventStream) {
            // Format as SSE: "data: <json>\n\n"
            const sseMessage = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(sseMessage));
          }
          controller.close();
        } catch (error) {
          // Send error event before closing
          const errorEvent = {
            type: "error",
            error: {
              message: error instanceof Error ? error.message : "Stream error",
            },
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof ParallelConfigError) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    console.error("SSE proxy error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "SSE connection failed" },
      { status: 500 }
    );
  }
}
