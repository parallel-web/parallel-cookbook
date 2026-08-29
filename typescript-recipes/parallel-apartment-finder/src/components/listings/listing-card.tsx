"use client"

import { Z, FONT_HEADING } from "@/lib/palette"
import { pickSourceUrl } from "@/lib/utils"
import { MatchPills } from "./match-pills"
import { Citations } from "./citations"
import type { Listing } from "@/types"

function scorePalette(score: number | null | undefined) {
  if (score == null) return { fg: Z.textFaint, bg: Z.bgSubtle, border: Z.border }
  if (score >= 70) return { fg: Z.green, bg: Z.greenSoft, border: "#BAE0C2" }
  if (score >= 45) return { fg: Z.amber, bg: "#FFF4E0", border: "#F7D9A8" }
  return { fg: Z.red, bg: Z.redSoft, border: "#F4B5B5" }
}

interface ListingCardProps {
  l: Listing
  idx: number
  city: string
  stale: boolean
  saved: boolean
  candidate?: boolean
  fraudChecking?: boolean
  onToggleSave: () => void
  isHovered?: boolean
  onHover?: () => void
  onLeave?: () => void
}

export function ListingCard({
  l, idx, city, stale, saved, candidate, fraudChecking, onToggleSave, isHovered, onHover, onLeave,
}: ListingCardProps) {
  // Always link to the specific source page, never a bare domain/homepage:
  // prefer the listing URL, then a deep citation, then an address search.
  const searchFallback = `https://www.google.com/search?q=${encodeURIComponent(`${l.address ?? l.title ?? ""} rent ${city}`)}`
  const href = pickSourceUrl(l.url, l.citations, searchFallback)
  const scoreP = scorePalette(l.score)
  return (
    <article
      data-listing-id={l.id}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="group rounded-2xl p-5 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        backgroundColor: Z.bgCard,
        // Per-side borders (not the `border` shorthand): the left edge is a
        // thicker score-colored accent, and React warns when a shorthand and
        // a longhand for the same property are mixed in one style object.
        borderTop: `1px solid ${saved || isHovered ? Z.blueBorder : Z.border}`,
        borderRight: `1px solid ${saved || isHovered ? Z.blueBorder : Z.border}`,
        borderBottom: `1px solid ${saved || isHovered ? Z.blueBorder : Z.border}`,
        borderLeft: `3px solid ${scoreP.border}`,
        boxShadow: isHovered
          ? `0 8px 24px rgba(31,69,252,0.12), 0 0 0 1px ${Z.blueBorder}`
          : `0 1px 2px rgba(15,17,21,0.04)`,
      }}
    >
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className="text-[11px] font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: Z.bgSubtle, color: Z.textMid }}
        >
          {idx + 1}
        </span>
        {l.neighborhood && (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-semibold"
            style={{ color: Z.textMid }}
            title={l.geo_precision === "neighborhood" ? "Map location approximated to the neighborhood center" : undefined}
          >
            <PinIcon size={10} color={Z.textFaint} />
            {l.neighborhood}{l.geo_precision === "neighborhood" ? " ≈" : ""}
          </span>
        )}
        <span
          className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded tracking-[0.08em]"
          style={{ backgroundColor: Z.bgSubtle, color: Z.textMid }}
        >
          {l.source}
        </span>
        {l.score != null && (
          <span
            className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded tracking-[0.08em]"
            style={{ backgroundColor: scoreP.bg, color: scoreP.fg, border: `1px solid ${scoreP.border}` }}
            title="Match score: price fit + proximity to reference point. Proximity is discounted for neighborhood-level locations and neutral when the address can't be geocoded."
          >
            {l.score}/100
          </span>
        )}
        {candidate && (
          <span
            className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded tracking-[0.08em]"
            style={{ backgroundColor: Z.blueSoft, color: Z.blueDarker, border: `1px solid ${Z.blueBorder}` }}
            title="Search still running — this is a candidate, not a verified match yet. Details and links may change or drop out."
          >
            candidate
          </span>
        )}
        {stale && (
          <span
            className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded tracking-[0.08em]"
            style={{ backgroundColor: "#FFF4E0", color: "#A66300", border: `1px solid #F7D9A8` }}
            title="May be stale — aggregator listing past freshness window, or API marked it inactive."
          >
            stale?
          </span>
        )}
        {l.needs_verification && fraudChecking && (
          <span
            className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded tracking-[0.08em] animate-pulse"
            style={{ backgroundColor: Z.bgSubtle, color: Z.textFaint, border: `1px solid ${Z.border}` }}
            title="Fraud check in progress — Task API is verifying scam signals against the page."
          >
            checking…
          </span>
        )}
        {l.spam_flags != null && (
          (l.spam_score ?? 0) > 0 ? (
            <span
              className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded tracking-[0.08em]"
              style={{ backgroundColor: Z.redSoft, color: Z.red, border: `1px solid #F4B5B5` }}
              title={`Fraud check flags: ${l.spam_flags.join(", ")}`}
            >
              ⚠ fraud: {l.spam_score}
            </span>
          ) : (
            <span
              className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded tracking-[0.08em]"
              style={{ backgroundColor: Z.greenSoft, color: Z.green, border: `1px solid #BAE0C2` }}
              title="Fraud check passed — no scam signals found by the Task API."
            >
              ✓ fraud: clear
            </span>
          )
        )}
        <button
          type="button"
          onClick={onToggleSave}
          aria-pressed={saved}
          title={saved ? "Remove from saved targets" : "Save this target"}
          className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1 shrink-0"
          style={{
            color: saved ? Z.blueDark : Z.textMid,
            backgroundColor: saved ? Z.blueSoft : "transparent",
            border: `1px solid ${saved ? Z.blueBorder : Z.border}`,
            fontFamily: FONT_HEADING,
          }}
        >
          <StarIcon filled={saved} />
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      <div className="flex items-start justify-between gap-4 mb-3">
        {/* Candidates aren't clickable: their URLs haven't passed verification
            yet and may change or drop out. The link activates once verified. */}
        {candidate ? (
          <span
            title="Link activates once this candidate is verified"
            className="text-[18px] font-bold block leading-tight flex-1 min-w-0 truncate cursor-default"
            style={{ color: Z.text, fontFamily: FONT_HEADING, letterSpacing: "-0.01em" }}
          >
            {l.address ?? l.title ?? "—"}
          </span>
        ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[18px] font-bold hover:underline block leading-tight flex-1 min-w-0 truncate"
          style={{ color: Z.text, fontFamily: FONT_HEADING, letterSpacing: "-0.01em" }}
        >
          {l.address ?? l.title ?? "—"}
        </a>
        )}
        <div className="text-right shrink-0">
          <div
            className="text-[26px] font-bold leading-none"
            style={{ color: Z.text, fontFamily: FONT_HEADING, letterSpacing: "-0.025em" }}
          >
            {l.price ? `$${l.price.toLocaleString()}` : "—"}
          </div>
          {l.price && (
            <div className="text-[10px] mt-1 uppercase tracking-wider font-semibold" style={{ color: Z.textFaint }}>
              per month
            </div>
          )}
        </div>
      </div>

      <div className="text-sm flex flex-wrap items-center gap-x-2 mb-2" style={{ color: Z.textMid }}>
        <strong style={{ color: Z.text, fontWeight: 600 }}>{l.bedrooms ?? "?"}</strong>
        <span>bd</span>
        {l.bathrooms != null && (<><span style={{ color: Z.textFaint }}>·</span><strong style={{ color: Z.text, fontWeight: 600 }}>{l.bathrooms}</strong><span>ba</span></>)}
        {l.sqft != null && (<><span style={{ color: Z.textFaint }}>·</span><strong style={{ color: Z.text, fontWeight: 600 }}>{l.sqft.toLocaleString()}</strong><span>sqft</span></>)}
        {l.has_parking && (<><span style={{ color: Z.textFaint }}>·</span><span>parking</span></>)}
        {l.has_laundry && (<><span style={{ color: Z.textFaint }}>·</span><span>laundry</span></>)}
      </div>

      {(l.details?.available_date || l.details?.lease_term || l.details?.pet_policy || l.details?.utilities_included || l.details?.is_furnished) && (
        <div className="text-[12px] flex flex-wrap gap-x-4 gap-y-1 mb-1" style={{ color: Z.textMid }}>
          {l.details?.available_date && <span><span style={{ color: Z.textFaint }}>Available</span> <strong style={{ color: Z.text, fontWeight: 600 }}>{l.details.available_date}</strong></span>}
          {l.details?.lease_term && <span><span style={{ color: Z.textFaint }}>Lease</span> <strong style={{ color: Z.text, fontWeight: 600 }}>{l.details.lease_term}</strong></span>}
          {l.details?.pet_policy && <span><span style={{ color: Z.textFaint }}>Pets</span> <strong style={{ color: Z.text, fontWeight: 600 }}>{l.details.pet_policy}</strong></span>}
          {l.details?.utilities_included && <span><span style={{ color: Z.textFaint }}>Utilities</span> <strong style={{ color: Z.text, fontWeight: 600 }}>{l.details.utilities_included}</strong></span>}
          {l.details?.is_furnished === true && <span><strong style={{ color: Z.text, fontWeight: 600 }}>Furnished</strong></span>}
        </div>
      )}

      <MatchPills listing={l} />
      <Citations listing={l} disabled={candidate} />
    </article>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width={12} height={12} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

function PinIcon({ size = 12, color = Z.textFaint }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
