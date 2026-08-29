import { NextRequest, NextResponse } from "next/server"
import { taskCreate } from "@/lib/server/parallel"
import { SPAM_SCHEMA, TASK_SPAM_PROCESSOR } from "@/lib/server/verify"

// Start a Task-API secondary verification of one listing (fact-based spam
// flags). Returns the run id; the client polls GET /api/verify/[id].
export async function POST(req: NextRequest) {
  let body: { title?: string; body?: string; price?: number | null; address?: string | null; source?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ detail: "invalid JSON body" }, { status: 422 })
  }
  try {
    const runId = await taskCreate(
      {
        title: body.title ?? "",
        body: (body.body ?? "").slice(0, 4000),
        price: body.price ?? null,
        address: body.address ?? null,
        source: body.source ?? "",
      },
      SPAM_SCHEMA,
      TASK_SPAM_PROCESSOR,
    )
    return NextResponse.json({ runId })
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "verify create failed" }, { status: 502 },
    )
  }
}
