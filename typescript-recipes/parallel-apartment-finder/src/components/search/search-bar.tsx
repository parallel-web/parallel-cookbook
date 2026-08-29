"use client"

import { useState } from "react"
import { Z, FONT_HEADING, FONT_BODY, FONT_MONO } from "@/lib/palette"
import { BAY_AREA_CITIES } from "@/lib/bay-area"
import { MAJOR_SOURCES } from "@/lib/sources"
import type { useSources } from "@/hooks/use-sources"

interface SearchBarProps {
  query: string
  onQueryChange: (q: string) => void
  city: string
  onCityChange: (c: string) => void
  requirements: string
  onRequirementsChange: (r: string) => void
  sources: ReturnType<typeof useSources>
  onSubmit: (e: React.FormEvent) => void
  streaming: boolean
}

export function SearchBar({
  query, onQueryChange,
  city, onCityChange,
  requirements, onRequirementsChange,
  sources,
  onSubmit, streaming,
}: SearchBarProps) {
  const [showReqs, setShowReqs] = useState(!!requirements)
  const [showSources, setShowSources] = useState(false)
  const [customInput, setCustomInput] = useState("")
  const [customError, setCustomError] = useState(false)

  const cityKnown = BAY_AREA_CITIES.some((c) => c.label === city)
  const includeCount = sources.includeSources.length

  const submitCustom = () => {
    if (!customInput.trim()) return
    if (sources.addCustom(customInput)) {
      setCustomInput("")
      setCustomError(false)
    } else {
      setCustomError(true)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      {/* City + toggles row */}
      <div
        className="rounded-xl flex items-center gap-2 px-3 py-2 flex-wrap"
        style={{
          backgroundColor: Z.bgCard,
          border: `1px solid ${Z.border}`,
        }}
      >
        <MapPinIcon />
        <select
          value={cityKnown ? city : BAY_AREA_CITIES[0].label}
          onChange={(e) => onCityChange(e.target.value)}
          aria-label="Bay Area city"
          className="bg-transparent text-sm focus:outline-none cursor-pointer pr-1"
          style={{ color: Z.text, fontFamily: FONT_BODY, fontWeight: 600 }}
        >
          {BAY_AREA_CITIES.map((c) => (
            <option key={c.key} value={c.label}>{c.label}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSources(!showSources)}
            className="text-xs font-bold px-2.5 py-1 rounded-lg transition-colors"
            style={{
              color: showSources || sources.hasIncludes ? Z.blueDark : Z.textMid,
              backgroundColor: showSources || sources.hasIncludes ? Z.blueSoft : "transparent",
              border: `1px solid ${showSources || sources.hasIncludes ? Z.blueBorder : Z.border}`,
              fontFamily: FONT_HEADING,
            }}
          >
            Include sites{includeCount ? ` · ${includeCount}` : ""}
          </button>
          <button
            type="button"
            onClick={() => setShowReqs(!showReqs)}
            className="text-xs font-bold px-2.5 py-1 rounded-lg transition-colors"
            style={{
              color: showReqs ? Z.blueDark : Z.textMid,
              backgroundColor: showReqs ? Z.blueSoft : "transparent",
              border: `1px solid ${showReqs ? Z.blueBorder : Z.border}`,
              fontFamily: FONT_HEADING,
            }}
          >
            + Requirements
          </button>
        </div>
      </div>

      {/* Sources row (collapsible) */}
      {showSources && (
        <div
          className="rounded-xl px-3 py-2.5"
          style={{ backgroundColor: Z.bgCard, border: `1px solid ${Z.border}` }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {MAJOR_SOURCES.map((s) => {
              const on = sources.selected.includes(s.domain)
              return (
                <button
                  key={s.domain}
                  type="button"
                  onClick={() => sources.toggle(s.domain)}
                  aria-pressed={on}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                  style={{
                    color: on ? Z.blueDarker : Z.textFaint,
                    backgroundColor: on ? Z.blueSoft : "transparent",
                    border: `1px solid ${on ? Z.blueBorder : Z.border}`,
                  }}
                >
                  {s.label}
                </button>
              )
            })}
            {sources.custom.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => sources.removeCustom(d)}
                title="Remove this site"
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                style={{
                  color: Z.blueDarker,
                  backgroundColor: Z.blueSoft,
                  border: `1px dashed ${Z.blueBorder}`,
                }}
              >
                {d} ✕
              </button>
            ))}
            <span className="inline-flex items-center gap-1">
              <input
                type="text"
                value={customInput}
                placeholder="Other… (e.g. mybroker.com)"
                onChange={(e) => { setCustomInput(e.target.value); setCustomError(false) }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); submitCustom() }
                }}
                className="text-[11px] px-2.5 py-1 rounded-full focus:outline-none w-44"
                style={{
                  color: Z.text,
                  backgroundColor: "transparent",
                  border: `1px dashed ${customError ? Z.red : Z.border}`,
                  fontFamily: FONT_BODY,
                }}
              />
              {customInput.trim() && (
                <button
                  type="button"
                  onClick={submitCustom}
                  className="text-[11px] font-bold px-2 py-1 rounded-full"
                  style={{ color: Z.blueDark, border: `1px solid ${Z.blueBorder}`, backgroundColor: Z.blueSoft }}
                >
                  Add
                </button>
              )}
            </span>
          </div>
          <div className="mt-1.5 text-[11px]" style={{ color: Z.textFaint }}>
            {customError
              ? "That doesn't look like a website — try a plain domain like example.com"
              : sources.hasIncludes
                ? `Searching the whole web and making sure to include ${includeCount} ${includeCount === 1 ? "site" : "sites"}.`
                : "Searches the whole web. Pick sites to make sure they're included, or add your own."}
          </div>
        </div>
      )}

      {/* Requirements row (collapsible) */}
      {showReqs && (
        <div
          className="rounded-xl px-3 py-2"
          style={{
            backgroundColor: Z.bgCard,
            border: `1px solid ${Z.border}`,
          }}
        >
          <input
            type="text"
            placeholder="Must-haves: e.g. in-unit laundry, pet-friendly, near BART, parking"
            value={requirements}
            onChange={(e) => onRequirementsChange(e.target.value)}
            className="w-full bg-transparent text-sm focus:outline-none"
            style={{ color: Z.text, fontFamily: FONT_BODY }}
          />
        </div>
      )}

      {/* Main search bar */}
      <div
        className="rounded-2xl flex flex-col sm:flex-row gap-2 p-2"
        style={{
          backgroundColor: Z.bgCard,
          border: `1px solid ${Z.border}`,
          boxShadow: "0 4px 20px rgba(15,17,21,0.06), 0 1px 3px rgba(15,17,21,0.04)",
        }}
      >
        <div className="flex-1 flex items-center px-3 gap-2 min-w-0">
          <SearchIcon />
          <input
            type="text"
            placeholder="Describe what you're looking for…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="flex-1 bg-transparent py-3 text-base focus:outline-none min-w-0"
            style={{ color: Z.text }}
            autoFocus
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || streaming}
          className="px-7 py-3 rounded-[4px] text-[13px] uppercase text-white disabled:opacity-50 transition-all hover:brightness-110 active:scale-[0.98] shrink-0"
          style={{ backgroundColor: Z.blue, fontFamily: FONT_MONO, fontWeight: 500, letterSpacing: "0.04em" }}
        >
          {streaming ? "Searching…" : "Search"}
        </button>
      </div>
    </form>
  )
}

function SearchIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={Z.textFaint} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function MapPinIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={Z.textFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
