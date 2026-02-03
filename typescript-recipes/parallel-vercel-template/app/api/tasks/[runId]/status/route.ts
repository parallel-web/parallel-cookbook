import { NextRequest, NextResponse } from "next/server";
import {
  getParallelClient,
  ParallelConfigError,
  errorResponse,
} from "@/lib/parallel";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  if (!runId) {
    return errorResponse("runId is required", 400);
  }

  try {
    const client = getParallelClient();

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
      } catch (error) {
        // Result not yet available for completed task - return status only
        console.debug(
          "Task completed but result not available yet:",
          runId,
          error instanceof Error ? error.message : error
        );
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
    if (error instanceof ParallelConfigError) {
      return errorResponse(error.message, 500);
    }
    console.error("Task status error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to get task status",
      500
    );
  }
}
