"use client"

import { Z, FONT_HEADING } from "@/lib/palette"
import type { Listing } from "@/types"

function avgPrice(listings: Listing[]): number | null {
  const priced = listings.filter((l) => l.price)
  if (priced.length === 0) return null
  return Math.round(priced.reduce((sum, l) => sum + (l.price ?? 0), 0) / priced.length)
}

interface StatsBarProps {
  listings: Listing[]
}

export function StatsBar({ listings }: StatsBarProps) {
  const avg = avgPrice(listings)
  const min = listings.reduce((m, l) => (l.price && (m == null || l.price < m) ? l.price : m), null as number | null)
  const high = listings.filter((l) => (l.score ?? 0) >= 70).length
  return (
    <div
      className="rounded-2xl px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2"
      style={{ backgroundColor: Z.bgCard, border: `1px solid ${Z.border}` }}
    >
      <Stat label="Matches" value={`${listings.length}`} accent />
      {high > 0 && <Stat label="Strong fit" value={`${high}`} color={Z.green} />}
      {avg != null && <Stat label="Avg rent" value={`$${avg.toLocaleString()}`} />}
      {min != null && <Stat label="Lowest" value={`$${min.toLocaleString()}`} />}
    </div>
  )
}

function Stat({ label, value, accent, color }: { label: string; value: string; accent?: boolean; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.12em] font-bold" style={{ color: Z.textFaint }}>
        {label}
      </span>
      <span
        className="text-lg font-bold leading-none"
        style={{ color: color ?? (accent ? Z.blue : Z.text), fontFamily: FONT_HEADING, letterSpacing: "-0.02em" }}
      >
        {value}
      </span>
    </div>
  )
}
