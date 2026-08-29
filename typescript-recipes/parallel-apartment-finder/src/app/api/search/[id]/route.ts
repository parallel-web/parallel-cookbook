import { NextRequest, NextResponse } from "next/server"
import { findallResult, findallStatus } from "@/lib/server/parallel"
import { parseCandidates, parseOptionsFrom } from "@/lib/server/listings"
import { DEFAULT_BUDGET } from "@/lib/server/config"

// One short poll: run state + metrics + the listings parsed so far.
// budget/minBeds come from the client (the server keeps no state).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!/^findall_[a-f0-9]+$/.test(id)) {
    return NextResponse.json({ detail: "invalid run id" }, { status: 422 })
  }
  const sp = req.nextUrl.searchParams
  const budget = Number(sp.get("budget")) || DEFAULT_BUDGET
  const minBedsRaw = sp.get("minBeds")
  const minBeds = minBedsRaw ? Number(minBedsRaw) || null : null

  try {
    const [status, candidates] = await Promise.all([
      findallStatus(id),
      findallResult(id).catch(() => []),
    ])
    const listings = parseCandidates(candidates, minBeds, budget, parseOptionsFrom(sp))
    // How many candidates have enriched rent values — lets the client tell
    // "discovery done" apart from "enrichment done" (both report completed).
    const rentPopulated = candidates.filter((c) => {
      const rent = c.output?.monthly_rent_usd
      return rent != null && String(rent.value ?? "").trim() !== ""
    }).length
    return NextResponse.json({
      state: status.state,
      generated: status.generated,
      matched: status.matched,
      rentPopulated,
      candidateCount: candidates.length,
      listings,
    })
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "poll failed" }, { status: 502 },
    )
  }
}
