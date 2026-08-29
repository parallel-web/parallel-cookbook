import { NextRequest, NextResponse } from "next/server"
import { taskStatus, taskResult } from "@/lib/server/parallel"
import { computeSpamScore } from "@/lib/server/verify"

// Poll a verification task. When it completes, compute the weighted spam
// score in code from the verified boolean facts.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!/^trun_[a-f0-9]+$/.test(id)) {
    return NextResponse.json({ detail: "invalid run id" }, { status: 422 })
  }
  try {
    const state = await taskStatus(id)
    if (["failed", "error", "cancelled"].includes(state)) {
      return NextResponse.json({ done: true, spamScore: 0, flags: [`task_${state}`] })
    }
    if (!["completed", "succeeded"].includes(state)) {
      return NextResponse.json({ done: false })
    }
    const content = await taskResult(id)
    const { score, flags } = computeSpamScore(content)
    return NextResponse.json({ done: true, spamScore: score, flags })
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "verify poll failed" }, { status: 502 },
    )
  }
}
