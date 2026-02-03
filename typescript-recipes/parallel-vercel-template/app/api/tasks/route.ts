import { NextRequest, NextResponse } from "next/server";
import {
  getParallelClient,
  ParallelConfigError,
  errorResponse,
  TASK_DEFAULTS,
} from "@/lib/parallel";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { input, processor } = body;

    if (!input) {
      return errorResponse("input is required", 400);
    }

    const client = getParallelClient();

    const selectedProcessor = processor || TASK_DEFAULTS.DEFAULT_PROCESSOR;
    const supportsAutoSchema =
      TASK_DEFAULTS.PROCESSORS_WITH_AUTO_SCHEMA.includes(selectedProcessor);

    const taskRun = await client.taskRun.create({
      input,
      processor: selectedProcessor,
      task_spec: supportsAutoSchema
        ? {
            output_schema: {
              type: "auto",
            },
          }
        : {
            output_schema: {
              type: "text",
            },
          },
    });

    return NextResponse.json(taskRun);
  } catch (error) {
    if (error instanceof ParallelConfigError) {
      return errorResponse(error.message, 500);
    }
    console.error("Tasks API error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Task creation failed",
      500
    );
  }
}
