import { NextRequest, NextResponse } from "next/server"
import { findallEnrich } from "@/lib/server/parallel"

// Kick the structured-enrichment pass (price, beds, address, …) once
// discovery completes. Client-driven; idempotent enough for our use — the
// client calls it exactly once when it sees discovery finish.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!/^findall_[a-f0-9]+$/.test(id)) {
    return NextResponse.json({ detail: "invalid run id" }, { status: 422 })
  }
  try {
    await findallEnrich(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "enrich failed" }, { status: 502 },
    )
  }
}
