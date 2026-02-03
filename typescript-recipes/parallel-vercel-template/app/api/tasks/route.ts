import { NextRequest, NextResponse } from "next/server";
import Parallel from "parallel-web";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { input, processor } = body;

    if (!input) {
      return NextResponse.json(
        { error: "input is required" },
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

    const selectedProcessor = processor || "lite";
    
    // Auto schema is only supported for pro and ultra processors
    const supportsAutoSchema = ["pro", "ultra"].includes(selectedProcessor);
    
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
    console.error("Tasks API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Task creation failed" },
      { status: 500 }
    );
  }
}
