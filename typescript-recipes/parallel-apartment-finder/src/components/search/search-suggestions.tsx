"use client"

import { Z, FONT_HEADING } from "@/lib/palette"

interface SearchSuggestionsProps {
  suggestions: string[]
  onSelect: (s: string) => void
  parsedBeds: number | null
  parsedBudget: number | null
  parsedNeighborhoods: string[]
  parsedSqft: number | null
  effectiveBudget: number
  budgetLikelyTooLow: boolean
  floor: number | null
  city: string
  query: string
  onQueryChange: (q: string) => void
}

export function SearchSuggestions({
  suggestions, onSelect,
  parsedBeds, parsedBudget, parsedNeighborhoods, parsedSqft, effectiveBudget,
  budgetLikelyTooLow, floor, city, query, onQueryChange,
}: SearchSuggestionsProps) {
  return (
    <>
      {(parsedBeds != null || parsedBudget != null || parsedNeighborhoods.length > 0 || parsedSqft != null) && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.12em] font-bold" style={{ color: Z.textFaint }}>
            Parsed
          </span>
          {parsedNeighborhoods.map((n) => (
            <span
              key={n}
              className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: Z.blueSoft, color: Z.blueDarker, border: `1px solid ${Z.blueBorder}` }}
              title="Neighborhood recognized in your query — the search will prioritize it"
            >
              📍 {n}
            </span>
          ))}
          {parsedBeds != null && (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: Z.blueSoft, color: Z.blueDarker, border: `1px solid ${Z.blueBorder}` }}
            >
              {parsedBeds === 0 ? "studio" : `${parsedBeds} bd`}
            </span>
          )}
          {parsedSqft != null && (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: Z.blueSoft, color: Z.blueDarker, border: `1px solid ${Z.blueBorder}` }}
              title="Minimum square footage recognized in your query"
            >
              ≥ {parsedSqft.toLocaleString()} sqft
            </span>
          )}
          {parsedBudget != null ? (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: Z.blueSoft, color: Z.blueDarker, border: `1px solid ${Z.blueBorder}` }}
            >
              ≤ ${parsedBudget.toLocaleString()}/mo
            </span>
          ) : (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: Z.bgSubtle, color: Z.textMid, border: `1px solid ${Z.border}` }}
              title="No budget detected in query — using a typical default for this bedroom count"
            >
              default ${effectiveBudget.toLocaleString()}/mo
            </span>
          )}
        </div>
      )}

      {budgetLikelyTooLow && floor != null && parsedBeds != null && parsedBudget != null && (
        <div
          className="mt-3 rounded-xl px-4 py-3 flex items-start sm:items-center gap-3 flex-col sm:flex-row"
          style={{ backgroundColor: "#FFF8E1", border: `1px solid #F2D896` }}
        >
          <div className="flex items-start gap-2 flex-1">
            <span className="text-base shrink-0 leading-none mt-0.5" aria-hidden>⚠️</span>
            <div className="text-[13px] leading-relaxed" style={{ color: "#5C4400" }}>
              <span className="font-bold">Heads up:</span>{" "}
              Typical{" "}
              {parsedBeds === 0 ? "studios" : `${parsedBeds}-bedroom rentals`}
              {" "}in {city} start around{" "}
              <strong style={{ color: "#3D2D00" }}>${floor.toLocaleString()}/month</strong>.{" "}
              Your query asks for <strong style={{ color: "#3D2D00" }}>under ${parsedBudget.toLocaleString()}</strong>{" "}
              — likely zero matches.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const newQuery = query
                .replace(/\$\s*[\d,]+(?:\.\d+)?\s*k?/gi, `$${floor.toLocaleString()}`)
                .replace(/\b(?:under|below|max(?:imum)?|less\s+than|up\s+to|cheaper\s+than)\s+\$?[\d,]+(?:\.\d+)?\s*k?/gi,
                  `under $${floor.toLocaleString()}`)
              onQueryChange(newQuery === query ? `${query.trim()} under $${floor.toLocaleString()}` : newQuery)
            }}
            className="text-xs font-bold px-3 py-1.5 rounded-lg shrink-0 transition-all hover:brightness-110 active:scale-[0.98]"
            style={{ backgroundColor: "#5C4400", color: "white", fontFamily: FONT_HEADING }}
          >
            Bump to ${floor.toLocaleString()}
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 items-center">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: Z.textFaint }}>
          Try
        </span>
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            className="text-xs px-3 py-1.5 rounded-full transition-all hover:-translate-y-0.5 hover:shadow-sm"
            style={{
              backgroundColor: Z.bgCard,
              border: `1px solid ${Z.border}`,
              color: Z.textSoft,
              fontWeight: 500,
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </>
  )
}
