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

    const taskRun = await client.taskRun.create({
      input,
      processor: processor || "lite",
      task_spec: {
        output_schema: {
          type: "auto",
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
