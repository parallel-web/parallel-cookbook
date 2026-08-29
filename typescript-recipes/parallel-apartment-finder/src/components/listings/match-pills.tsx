"use client"

import { Z } from "@/lib/palette"
import type { Listing } from "@/types"

export function MatchPills({ listing }: { listing: Listing }) {
  if (!listing.match_basis?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {listing.match_basis.map((m) => {
        const ok = m.matched
        return (
          <span
            key={m.name}
            className="text-[11px] px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"
            style={{
              backgroundColor: ok ? Z.blueSoft : Z.bgSubtle,
              color: ok ? Z.blueDarker : Z.textFaint,
              border: `1px solid ${ok ? Z.blueBorder : Z.borderSoft}`,
              fontWeight: 500,
            }}
          >
            {ok ? <CheckIcon size={10} color={Z.blue} /> : <span style={{ color: Z.textFaint, fontWeight: 700 }}>·</span>}
            <span>{m.name.replaceAll("_", " ")}</span>
            {m.value && (
              <span style={{ color: ok ? Z.text : Z.textFaint, opacity: 0.85, fontWeight: 400 }}>
                — {m.value.length > 28 ? m.value.slice(0, 28) + "…" : m.value}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

function CheckIcon({ size = 11, color = Z.blue }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
