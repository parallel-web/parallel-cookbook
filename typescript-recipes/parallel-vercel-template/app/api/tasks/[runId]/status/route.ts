import { NextRequest, NextResponse } from "next/server";
import Parallel from "parallel-web";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  if (!process.env.PARALLEL_API_KEY) {
    return NextResponse.json(
      { error: "PARALLEL_API_KEY is not configured" },
      { status: 500 }
    );
  }

  try {
    const client = new Parallel({
      apiKey: process.env.PARALLEL_API_KEY,
    });

    // Retrieve the task run status
    const taskRun = await client.taskRun.retrieve(runId);

    // If completed, also get the result
    if (taskRun.status === "completed") {
      try {
        const result = await client.taskRun.result(runId);
        return NextResponse.json({
          status: taskRun.status,
          output: result.output,
        });
      } catch {
        // Result might not be ready yet
        return NextResponse.json({
          status: taskRun.status,
        });
      }
    }

    // If failed, include error info
    if (taskRun.status === "failed") {
      return NextResponse.json({
        status: taskRun.status,
        error: taskRun.error,
      });
    }

    // For running/queued status
    return NextResponse.json({
      status: taskRun.status,
    });
  } catch (error) {
    console.error("Task status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get task status" },
      { status: 500 }
    );
  }
}
