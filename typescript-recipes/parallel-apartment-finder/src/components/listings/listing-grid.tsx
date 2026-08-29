"use client"

import { Z } from "@/lib/palette"
import { ListingCard } from "./listing-card"
import type { Listing } from "@/types"

interface ListingGridProps {
  listings: Listing[]
  city: string
  isStale: (l: Listing) => boolean
  isSaved: (l: Listing) => boolean
  onToggleSave: (l: Listing) => void
  hoveredId: string | null
  onHover: (id: string) => void
  onLeave: () => void
  streaming: boolean
  fraudChecking?: boolean
  hiddenLowScoreCount: number
  hiddenStaleCount: number
  hiddenSpamCount: number
  showAllScores: boolean
  autoShowAll?: boolean
  showStale: boolean
  showSpam: boolean
  onToggleScores: () => void
  onToggleStale: () => void
  onToggleSpam: () => void
}

export function ListingGrid({
  listings, city, isStale, isSaved, onToggleSave,
  hoveredId, onHover, onLeave, streaming, fraudChecking,
  hiddenLowScoreCount, hiddenStaleCount, hiddenSpamCount,
  showAllScores, autoShowAll, showStale, showSpam,
  onToggleScores, onToggleStale, onToggleSpam,
}: ListingGridProps) {
  return (
    <div className="space-y-4">
      {autoShowAll && listings.length > 0 && (
        <div
          className="rounded-xl px-4 py-2.5 text-[13px]"
          style={{ backgroundColor: Z.blueSofter, border: `1px solid ${Z.blueBorder}`, color: Z.textMid }}
        >
          None of these cleared the strong-fit bar, so we&apos;re showing every
          match ranked by fit — rather than an empty list.
        </div>
      )}
      {listings.length === 0 && streaming && (<><SkeletonCard /><SkeletonCard /><SkeletonCard /></>)}
      {listings.length === 0 && !streaming && (
        <div
          className="rounded-2xl p-8 text-center"
          style={{ backgroundColor: Z.bgCard, border: `1px dashed ${Z.border}` }}
        >
          <p className="text-sm font-semibold mb-1" style={{ color: Z.text }}>
            No matching listings found
          </p>
          <p className="text-sm" style={{ color: Z.textMid }}>
            Try a broader query, a higher budget, or a different area{city ? ` in ${city}` : ""}.
          </p>
        </div>
      )}
      {listings.map((l, i) => (
        <ListingCard
          key={l.id} l={l} idx={i} city={city}
          stale={isStale(l)}
          saved={isSaved(l)}
          candidate={streaming}
          fraudChecking={fraudChecking}
          onToggleSave={() => onToggleSave(l)}
          isHovered={hoveredId === l.id}
          onHover={() => onHover(l.id)}
          onLeave={onLeave}
        />
      ))}
      <div className="flex flex-col sm:flex-row gap-2 mt-2">
        {!autoShowAll && (
          <HiddenScoresToggle
            hiddenCount={hiddenLowScoreCount}
            showAll={showAllScores}
            onToggle={onToggleScores}
          />
        )}
        <StaleToggle
          hiddenCount={hiddenStaleCount}
          showStale={showStale}
          onToggle={onToggleStale}
        />
        <SpamToggle
          hiddenCount={hiddenSpamCount}
          showSpam={showSpam}
          onToggle={onToggleSpam}
        />
      </div>
    </div>
  )
}

function SpamToggle({ hiddenCount, showSpam, onToggle }: { hiddenCount: number; showSpam: boolean; onToggle: () => void }) {
  if (hiddenCount === 0 && !showSpam) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex-1 py-3 rounded-xl text-sm transition-colors hover:bg-white"
      style={{
        backgroundColor: Z.bgCard,
        border: `1px dashed #F4B5B5`,
        color: Z.textMid,
      }}
      title="Flagged by the Task API secondary check: fact-based scam signals (off-platform payment, owner abroad, withheld address, no viewings, unusual incentives)."
    >
      {showSpam
        ? <>← <span className="font-semibold">Re-hide likely-scam listings</span></>
        : <>Show <strong style={{ color: Z.red }}>{hiddenCount}</strong> flagged as likely {hiddenCount === 1 ? "scam" : "scams"} →</>
      }
    </button>
  )
}

// Mirrors the real ListingCard layout — no photo block, since result cards
// never render images.
function SkeletonCard() {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: Z.bgCard, border: `1px solid ${Z.border}` }}
    >
      <div className="p-5 space-y-3">
        <div className="h-3 w-24 rounded animate-pulse" style={{ backgroundColor: Z.bgSubtle }} />
        <div className="h-5 w-3/4 rounded animate-pulse" style={{ backgroundColor: Z.bgSubtle }} />
        <div className="h-4 w-1/2 rounded animate-pulse" style={{ backgroundColor: Z.bgSubtle }} />
        <div className="flex gap-2">
          <div className="h-5 w-20 rounded-full animate-pulse" style={{ backgroundColor: Z.bgSubtle }} />
          <div className="h-5 w-24 rounded-full animate-pulse" style={{ backgroundColor: Z.bgSubtle }} />
          <div className="h-5 w-16 rounded-full animate-pulse" style={{ backgroundColor: Z.bgSubtle }} />
        </div>
      </div>
    </div>
  )
}

function HiddenScoresToggle({ hiddenCount, showAll, onToggle }: { hiddenCount: number; showAll: boolean; onToggle: () => void }) {
  if (hiddenCount === 0 && !showAll) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex-1 py-3 rounded-xl text-sm transition-colors hover:bg-white"
      style={{
        backgroundColor: Z.bgCard,
        border: `1px dashed ${Z.border}`,
        color: Z.textMid,
      }}
    >
      {showAll
        ? <>← <span className="font-semibold">Hide poor-fit results</span> (strong fits only)</>
        : <>Show <strong style={{ color: Z.text }}>{hiddenCount}</strong> below the strong-fit bar →</>
      }
    </button>
  )
}

function StaleToggle({ hiddenCount, showStale, onToggle }: { hiddenCount: number; showStale: boolean; onToggle: () => void }) {
  if (hiddenCount === 0 && !showStale) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex-1 py-3 rounded-xl text-sm transition-colors hover:bg-white"
      style={{
        backgroundColor: Z.bgCard,
        border: `1px dashed ${Z.border}`,
        color: Z.textMid,
      }}
      title="Listings on aggregator sites (Zillow, Apartments.com, etc.) often stay live in the index after the unit has been rented. Hidden by default."
    >
      {showStale
        ? <>← <span className="font-semibold">Re-hide likely-stale aggregator listings</span></>
        : <>Show <strong style={{ color: Z.text }}>{hiddenCount}</strong> likely-stale aggregator {hiddenCount === 1 ? "listing" : "listings"} →</>
      }
    </button>
  )
}
