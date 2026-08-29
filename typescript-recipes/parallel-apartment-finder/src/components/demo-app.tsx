"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import dynamic from "next/dynamic"
import { useConfigState } from "@/providers/config-provider"
import { useSearch } from "@/hooks/use-search"
import { useSavedTargets } from "@/hooks/use-saved-targets"
import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"
import { SearchBar } from "@/components/search/search-bar"
import { SearchStatus } from "@/components/search/search-status"
import { SearchSuggestions } from "@/components/search/search-suggestions"
import { DiscoveryField } from "@/components/search/discovery-field"
import { searchAudio } from "@/lib/search-audio"
import { StatsBar } from "@/components/stats/stats-bar"
import { ReasoningPanel } from "@/components/reasoning/reasoning-panel"
import { ListingGrid } from "@/components/listings/listing-grid"
import { Z, FONT_HEADING, FONT_BODY } from "@/lib/palette"
import { extractNeighborhoodsFromQuery } from "@/lib/neighborhoods"
import { cityByName, cityInQuery } from "@/lib/bay-area"
import { useSources } from "@/hooks/use-sources"
import type { AppConfig, Listing, ViewMode } from "@/types"

const ApartmentMap = dynamic(
  () => import("@/components/map/apartment-map").then((m) => m.ApartmentMap),
  { ssr: false }
)

const WORD_TO_NUM: Record<string, number> = {
  studio: 0, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
}

function extractBedsFromQuery(query: string): number | null {
  if (/\bstudio\b/i.test(query)) return 0
  const m = query.match(/\b(\d+|one|two|three|four|five|six)\s*[-+]?\s*(?:br|bed|bedroom|bedrooms)\b/i)
  if (!m) return null
  const w = m[1].toLowerCase()
  if (WORD_TO_NUM[w] != null) return WORD_TO_NUM[w]
  const n = parseInt(w)
  return Number.isFinite(n) ? n : null
}

function realisticFloor(beds: number | null, floors: Record<string, number>): number | null {
  if (beds == null) return null
  return floors[String(beds)] ?? floors[String(Math.min(beds, 5))] ?? null
}

function makeIsStale(
  staleness: { aggregatorSources: string[]; aggregatorDays: number; directDays: number },
) {
  const aggregators = new Set(staleness.aggregatorSources)
  return (l: Listing): boolean => {
    const det = l.details ?? {}
    if (det.is_currently_active === false) return true

    const dom = (det as { days_on_market?: number }).days_on_market
    if (typeof dom === "number" && Number.isFinite(dom)) {
      const limit = aggregators.has(l.source) ? staleness.aggregatorDays : staleness.directDays
      return dom > limit
    }

    const referenceTs =
      (det as { monitor_event_date?: string }).monitor_event_date ?? l.fetched_at ?? null
    if (!referenceTs) return false
    const ageDays = (Date.now() - new Date(referenceTs).getTime()) / 86_400_000
    if (!Number.isFinite(ageDays)) return false
    const limit = aggregators.has(l.source) ? staleness.aggregatorDays : staleness.directDays
    return ageDays > limit
  }
}

function extractBudgetFromQuery(query: string): number | null {
  const dollar = query.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k)?/i)
  if (dollar) {
    let n = parseFloat(dollar[1].replace(/,/g, ""))
    if (dollar[2]) n *= 1000
    if (n >= 500 && n <= 30000) return Math.round(n)
  }
  const ctx = query.match(
    /\b(?:under|below|max(?:imum)?|less\s+than|up\s+to|cheaper\s+than|<=?)\s+\$?([\d,]+(?:\.\d+)?)\s*(k)?\b/i,
  )
  if (ctx) {
    let n = parseFloat(ctx[1].replace(/,/g, ""))
    if (ctx[2]) n *= 1000
    if (n >= 500 && n <= 30000) return Math.round(n)
  }
  const kBare = query.match(/(?<![\d$])(\d+(?:\.\d+)?)\s*k\b/i)
  if (kBare) {
    const n = parseFloat(kBare[1]) * 1000
    if (n >= 500 && n <= 30000) return Math.round(n)
  }
  return null
}

// Minimum square footage from phrases like "1000 sq ft", "1,200 sqft",
// "900+ square feet". Bare "sf" is intentionally not matched — it collides
// with "SF" (San Francisco).
function extractSqftFromQuery(query: string): number | null {
  const m = query.match(/(\d[\d,]{2,})\s*\+?\s*(?:sq\s*\.?\s*ft\.?|sqft|square\s+f(?:ee|oo)t)\b/i)
  if (!m) return null
  const n = parseInt(m[1].replace(/,/g, ""), 10)
  return Number.isFinite(n) && n >= 100 && n <= 20000 ? n : null
}

// Fold a parsed min-sqft into the free-text requirements handed to FindAll so
// the objective actually asks for it (there's no dedicated sqft filter).
function withSqft(requirements: string, sqft: number | null): string | undefined {
  const parts = [requirements.trim(), sqft ? `at least ${sqft} square feet` : ""].filter(Boolean)
  return parts.length ? parts.join(". ") : undefined
}

function defaultBudgetForBeds(beds: number | null, floors: Record<string, number>, fallback: number): number {
  const floor = realisticFloor(beds, floors)
  // Default budgets err on the HIGH side (1.5x the entry-level floor): a
  // too-low default filters out most real inventory, while a generous one
  // still ranks cheaper units first (price fit is a scoring signal).
  return floor != null ? Math.round(floor * 1.5 / 250) * 250 : fallback
}

function CenteredScreen({ title, body, color }: { title: string; body: string; color?: string }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ backgroundColor: Z.bgPage, color: Z.text, fontFamily: FONT_BODY }}
    >
      <div className="max-w-md text-center">
        <div className="text-xs font-bold uppercase tracking-[0.16em] mb-3" style={{ color: color ?? Z.textFaint }}>
          {title}
        </div>
        <p className="text-base leading-relaxed" style={{ color: Z.textMid }}>
          {body}
        </p>
      </div>
    </div>
  )
}

function SparkleIcon({ size = 14, color = "white" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 2 14 9 21 11 14 13 12 20 10 13 3 11 10 9z" />
    </svg>
  )
}

export default function DemoApp() {
  const { config, loading, error: configError } = useConfigState()

  if (loading) {
    return <CenteredScreen title="Loading" body="Fetching configuration…" />
  }
  if (configError) {
    return (
      <CenteredScreen
        title="Config unavailable"
        color={Z.red}
        body={`Couldn't load the app configuration: ${configError}.`}
      />
    )
  }
  if (!config) {
    return <CenteredScreen title="No config" body="The /api/config response was empty." />
  }
  return <DemoAppInner config={config} />
}

function DemoAppInner({ config }: { config: AppConfig }) {
  const [city, setCity] = useState(config.cityShort)
  const [requirements, setRequirements] = useState("")

  const [view, setView] = useState<ViewMode>("list")
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const cardListRef = useRef<HTMLDivElement | null>(null)

  const {
    query, setQuery,
    reasoning, streaming, listings, error, done, phase, startedAt, progress,
    fraudChecking, runFraudCheck,
    startSearch,
  } = useSearch()

  // Procedural "AI searching" sound. Default on; preference persists.
  const [soundOn, setSoundOn] = useState(true)
  useEffect(() => {
    if (localStorage.getItem("apartment-finder-sound") === "off") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSoundOn(false)
      searchAudio.setMuted(true)
    }
  }, [])
  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      const next = !on
      searchAudio.setMuted(!next)
      localStorage.setItem("apartment-finder-sound", next ? "on" : "off")
      return next
    })
  }, [])
  // Blip each time a new candidate verifies; stop (with a chime on success)
  // when the run ends. start() is called from the click handlers so the
  // AudioContext resumes within a user gesture.
  const prevMatchedRef = useRef(0)
  useEffect(() => {
    if (streaming && progress.matched > prevMatchedRef.current) {
      for (let n = prevMatchedRef.current; n < progress.matched; n++) searchAudio.tick(n)
    }
    prevMatchedRef.current = progress.matched
  }, [progress.matched, streaming])
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) searchAudio.stop(done)
    wasStreamingRef.current = streaming
  }, [streaming, done])

  const { saved, isSaved, toggleSave, clearSaved } = useSavedTargets()
  const sources = useSources()

  // Warm the Leaflet map chunk while the user is idle so toggling to the map
  // view doesn't pay the dynamic-import cost.
  useEffect(() => {
    const warm = () => { void import("@/components/map/apartment-map") }
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm)
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(warm, 2500)
    return () => clearTimeout(t)
  }, [])

  const bayCity = useMemo(() => cityByName(city), [city])
  const cityFloors = bayCity?.rentFloors ?? config.rentFloors
  // Center the map (and its reference-point marker) on the selected city.
  const mapConfig = useMemo(
    () => bayCity
      ? { ...config, mapCenter: bayCity.center, mapZoom: bayCity.zoom, referencePoint: bayCity.referencePoint }
      : config,
    [bayCity, config],
  )

  const parsedBeds = useMemo(() => extractBedsFromQuery(query), [query])
  const parsedBudget = useMemo(() => extractBudgetFromQuery(query), [query])
  const parsedNeighborhoods = useMemo(() => extractNeighborhoodsFromQuery(query, city), [query, city])
  const parsedSqft = useMemo(() => extractSqftFromQuery(query), [query])

  // If the query names a Bay Area city (case-insensitive, e.g. "Palo Alto
  // homes in the bubble"), switch the dropdown to it. Reacts to the query text
  // only, so a manual city pick sticks until the query changes again.
  useEffect(() => {
    const detected = cityInQuery(query)
    // Deriving the selected city from the query text is the intended effect,
    // not a cascading-render bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (detected && detected.label !== city) setCity(detected.label)
    // React to query only, so a manual city pick sticks until the query changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])
  const effectiveBudget = useMemo(
    () => parsedBudget ?? defaultBudgetForBeds(parsedBeds, cityFloors, config.defaultBudget),
    [parsedBudget, parsedBeds, cityFloors, config.defaultBudget],
  )

  const isStale = useMemo(() => makeIsStale(config.staleness), [config.staleness])

  const handleMarkerClick = useCallback((id: string) => {
    setHoveredId(id)
    const el = cardListRef.current?.querySelector(`[data-listing-id="${id}"]`)
    if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" })
  }, [])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setView("list")
    searchAudio.start() // within the click gesture, so the audio context resumes
    // Resolve the city from the query text itself, not the (possibly stale)
    // dropdown state, so the objective always matches what the user typed.
    const searchCity = cityInQuery(query) ?? bayCity
    if (searchCity && searchCity.label !== city) setCity(searchCity.label)
    const hoods = extractNeighborhoodsFromQuery(query, searchCity?.label ?? city)
    startSearch(query, effectiveBudget, {
      city: searchCity?.full ?? city,
      requirements: withSqft(requirements, parsedSqft),
      neighborhoods: hoods.length ? hoods : undefined,
      sources: sources.hasIncludes ? sources.includeSources : undefined,
    })
  }

  const STRONG_FIT_THRESHOLD = 70
  // Same threshold the original backend used (SPAM_HIDE_THRESHOLD): one
  // canonical scam signal from the Task API secondary check trips it.
  const SPAM_HIDE_THRESHOLD = 50

  const sortedListings = useMemo(
    () => [...listings].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [listings],
  )

  const [showAllScores, setShowAllScores] = useState(false)
  const [showStale, setShowStale] = useState(false)
  const [showSpam, setShowSpam] = useState(false)

  const isSpam = useCallback(
    (l: Listing) => (l.spam_score ?? 0) >= SPAM_HIDE_THRESHOLD,
    [SPAM_HIDE_THRESHOLD],
  )

  // How many listings clear the strong-fit bar (and aren't hidden as
  // stale/spam). If none do, we don't want to render an empty page while
  // weaker-but-real matches sit hidden — so auto-drop the bar in that case.
  const strongFitCount = useMemo(
    () => streaming ? 0 : sortedListings.filter((l) => (l.score ?? 0) >= STRONG_FIT_THRESHOLD && (showStale || !isStale(l)) && (showSpam || !isSpam(l))).length,
    [sortedListings, streaming, showStale, showSpam, isStale, isSpam],
  )
  const autoShowAll = !streaming && strongFitCount === 0
  const effectiveShowAll = showAllScores || autoShowAll
  // When nothing clears the strong-fit bar, revealing stale listings too keeps
  // us from rendering an empty page while real (if older) aggregator listings
  // sit hidden. They still carry the "stale?" badge. Spam stays hidden: it's a
  // safety signal, not a freshness one.
  const effectiveShowStale = showStale || autoShowAll

  const filteredListings = useMemo(() => {
    return sortedListings.filter((l) => {
      // While a search is streaming, show every verified card in live time —
      // provisional scores lack proximity/price points until finalize, so the
      // strong-fit bar only applies once the run completes.
      if (!streaming && !effectiveShowAll && (l.score ?? 0) < STRONG_FIT_THRESHOLD) return false
      if (!effectiveShowStale && isStale(l)) return false
      if (!showSpam && isSpam(l)) return false
      return true
    })
  }, [sortedListings, streaming, effectiveShowAll, effectiveShowStale, showSpam, isStale, isSpam])

  const hiddenLowScoreCount = useMemo(
    () => (streaming || effectiveShowAll) ? 0 : sortedListings.filter((l) => (l.score ?? 0) < STRONG_FIT_THRESHOLD && (showStale || !isStale(l)) && (showSpam || !isSpam(l))).length,
    [sortedListings, streaming, effectiveShowAll, showStale, showSpam, isStale, isSpam],
  )
  const hiddenStaleCount = useMemo(
    () => effectiveShowStale ? 0 : sortedListings.filter((l) => isStale(l) && (effectiveShowAll || (l.score ?? 0) >= STRONG_FIT_THRESHOLD)).length,
    [sortedListings, effectiveShowStale, effectiveShowAll, isStale],
  )
  const hiddenSpamCount = useMemo(
    () => sortedListings.filter((l) => isSpam(l)).length,
    [sortedListings, isSpam],
  )

  const savedSorted = useMemo(
    () => [...saved].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [saved],
  )

  const showingSaved = view === "saved"
  const visibleListings = showingSaved ? savedSorted : filteredListings

  // On the map, always fold in saved targets alongside the current results
  // (deduped) so the shortlist stays pinned for reference; saved markers are
  // rendered distinctly (orange, starred) in ApartmentMap.
  const savedIdSet = useMemo(() => new Set(saved.map((s) => s.id)), [saved])
  const mapListings = useMemo(() => {
    const byId = new Map<string, Listing>()
    for (const l of visibleListings) byId.set(l.id, l)
    for (const s of saved) if (!byId.has(s.id)) byId.set(s.id, s)
    return [...byId.values()]
  }, [visibleListings, saved])

  const floor = useMemo(() => realisticFloor(parsedBeds, cityFloors), [parsedBeds, cityFloors])
  const budgetLikelyTooLow = floor != null && parsedBudget != null && parsedBudget < floor

  const hasActivity = streaming || !!reasoning || listings.length > 0 || saved.length > 0

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: Z.bgPage, color: Z.text, fontFamily: FONT_BODY }}
    >
      <Header config={config} />

      {/* Hero / search */}
      <section
        className="relative overflow-hidden"
        style={{
          background: `radial-gradient(1100px 480px at 70% -10%, ${Z.blueSoft} 0%, ${Z.bgPage} 70%)`,
          borderBottom: `1px solid ${Z.borderSoft}`,
        }}
      >
        {/* Once a search is active, collapse the hero copy on mobile so results
            aren't pushed two screens down; desktop keeps the full hero. */}
        <div className={`max-w-6xl mx-auto px-6 ${hasActivity ? "pt-5 pb-4 sm:pt-8 sm:pb-5" : "pt-14 pb-12"}`}>
          {/* Brand credit: a real link to parallel.ai, visible on mobile and
              desktop, including mid-search. */}
          <a
            href="https://parallel.ai"
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors hover:brightness-95 ${hasActivity ? "mb-3 sm:mb-5" : "mb-5"}`}
            style={{ backgroundColor: Z.bgCard, border: `1px solid ${Z.border}` }}
          >
            <SparkleIcon size={12} color={Z.blue} />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: Z.blueDark }}>
              Powered by Parallel
            </span>
          </a>
          <h1
            className="font-medium mb-4 max-w-3xl"
            style={{
              fontFamily: FONT_HEADING,
              color: Z.text,
              // Keep the title on mobile even mid-search, just smaller; the
              // subheader, pill, and Try chips stay collapsed.
              fontSize: hasActivity ? "clamp(1.5rem, 5vw, 3.25rem)" : "clamp(2rem, 5vw, 3.25rem)",
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
            }}
          >
            Find your Bay Area rental in your own words.
          </h1>
          <p className={`text-base sm:text-lg mb-7 max-w-3xl leading-relaxed ${hasActivity ? "hidden sm:block" : ""}`} style={{ color: Z.textMid }}>
            Describe what you want like you&apos;d tell a friend. The assistant searches the web
            across San Francisco, the East Bay, and the Peninsula,
            verifies every match against your criteria, and returns each result with cited sources.
            No more couch-surfing.
          </p>

          <SearchBar
            query={query}
            onQueryChange={setQuery}
            city={city}
            onCityChange={setCity}
            requirements={requirements}
            onRequirementsChange={setRequirements}
            sources={sources}
            onSubmit={onSubmit}
            streaming={streaming}
          />

          <div className={hasActivity ? "hidden sm:block" : ""}>
          <SearchSuggestions
            suggestions={config.suggestions}
            onSelect={(s) => {
              setQuery(s)
              searchAudio.start() // within the click gesture
              // Parse everything from the clicked suggestion itself. State
              // (city, effectiveBudget) still reflects the previous query
              // during this event, so resolve the city from `s` directly —
              // otherwise the search fires against the old city.
              const selCity = cityInQuery(s) ?? bayCity
              if (selCity && selCity.label !== city) setCity(selCity.label)
              const beds = extractBedsFromQuery(s)
              const budget = extractBudgetFromQuery(s)
                ?? defaultBudgetForBeds(beds, selCity?.rentFloors ?? cityFloors, config.defaultBudget)
              const hoods = extractNeighborhoodsFromQuery(s, selCity?.label ?? city)
              startSearch(s, budget, {
                city: selCity?.full ?? city,
                requirements: withSqft(requirements, extractSqftFromQuery(s)),
                neighborhoods: hoods.length ? hoods : undefined,
                sources: sources.hasIncludes ? sources.includeSources : undefined,
              })
            }}
            parsedBeds={parsedBeds}
            parsedBudget={parsedBudget}
            parsedNeighborhoods={parsedNeighborhoods}
            parsedSqft={parsedSqft}
            effectiveBudget={effectiveBudget}
            budgetLikelyTooLow={budgetLikelyTooLow}
            floor={floor}
            city={city}
            query={query}
            onQueryChange={setQuery}
          />
          </div>
        </div>
      </section>

      <main className={`max-w-6xl mx-auto px-6 ${hasActivity ? "pt-3 pb-8" : "py-8"}`}>
        {error && (
          <div
            className="rounded-xl p-4 mb-6 text-sm font-medium"
            style={{ backgroundColor: Z.redSoft, border: `1px solid #F4B5B5`, color: Z.red }}
          >
            {error}
          </div>
        )}

        {hasActivity ? (
          <>
            {!showingSaved && (
              <SearchStatus phase={phase} streaming={streaming} startedAt={startedAt} soundOn={soundOn} onToggleSound={toggleSound} />
            )}
            <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <div className="flex-1">
                <StatsBar listings={visibleListings} />
              </div>
              {done && listings.some((l) => l.needs_verification) && (
                <button
                  type="button"
                  onClick={() => void runFraudCheck()}
                  disabled={fraudChecking}
                  className="px-4 py-2 rounded-xl text-sm font-bold transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-60 shrink-0 inline-flex items-center gap-2"
                  style={{
                    backgroundColor: Z.bgCard,
                    color: Z.red,
                    border: `1px solid #F4B5B5`,
                    fontFamily: FONT_HEADING,
                  }}
                  title="Second run via the Parallel Task API: verifies fact-based scam signals (off-platform payment, owner abroad, withheld address, no viewings, unusual incentives) on each untrusted-source listing."
                >
                  {fraudChecking ? (
                    <>
                      <span
                        className="inline-block w-3.5 h-3.5 rounded-full animate-spin"
                        style={{ border: `2px solid #F4B5B5`, borderTopColor: Z.red }}
                      />
                      Checking…
                    </>
                  ) : (
                    <>🛡 Run fraud check</>
                  )}
                </button>
              )}
              <ViewToggle view={view} onChange={setView} savedCount={saved.length} />
            </div>

            {showingSaved && (
              <div ref={cardListRef}>
                {savedSorted.length === 0 ? (
                  <div
                    className="rounded-2xl p-8 text-center"
                    style={{ backgroundColor: Z.bgCard, border: `1px dashed ${Z.border}` }}
                  >
                    <p className="text-sm font-semibold mb-1" style={{ color: Z.text }}>No saved targets yet</p>
                    <p className="text-sm" style={{ color: Z.textMid }}>
                      Run a search and hit <strong>Save</strong> on the apartments you want to keep. They&apos;re stored only in this browser.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm" style={{ color: Z.textMid }}>
                        {savedSorted.length} saved {savedSorted.length === 1 ? "target" : "targets"} · kept in this browser only
                      </span>
                      <button
                        type="button"
                        onClick={clearSaved}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                        style={{ color: Z.textMid, border: `1px solid ${Z.border}`, fontFamily: FONT_HEADING }}
                      >
                        Clear all
                      </button>
                    </div>
                    <ListingGrid
                      listings={savedSorted}
                      city={city}
                      isStale={isStale}
                      isSaved={isSaved}
                      onToggleSave={toggleSave}
                      hoveredId={hoveredId}
                      onHover={(id) => setHoveredId(id)}
                      onLeave={() => setHoveredId(null)}
                      // While a run is in flight, saved cards stay inert too: a
                      // candidate saved mid-run must not be clickable until the
                      // FindAll run completes.
                      streaming={streaming}
                      hiddenLowScoreCount={0}
                      hiddenStaleCount={0}
                      hiddenSpamCount={0}
                      showAllScores
                      showStale
                      showSpam
                      onToggleScores={() => {}}
                      onToggleStale={() => {}}
                      onToggleSpam={() => {}}
                    />
                  </>
                )}
              </div>
            )}

            {view === "list" && (
              <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
                {/* On mobile, results come first; the process log follows. */}
                <div className="order-2 lg:order-1 min-w-0">
                  <ReasoningPanel reasoning={reasoning} streaming={streaming} done={done} phase={phase} progress={progress} />
                </div>
                <div ref={cardListRef} className="order-1 lg:order-2 min-w-0">
                  {/* While discovery runs with nothing to show, the field IS the
                      loading state; the grid's skeletons would double it up. */}
                  {streaming && visibleListings.length === 0 ? (
                    <DiscoveryField progress={progress} phase={phase?.key ?? "discover"} />
                  ) : (
                  <ListingGrid
                    listings={visibleListings}
                    city={city}
                    isStale={isStale}
                    isSaved={isSaved}
                    onToggleSave={toggleSave}
                    hoveredId={hoveredId}
                    onHover={(id) => setHoveredId(id)}
                    onLeave={() => setHoveredId(null)}
                    streaming={streaming}
                    fraudChecking={fraudChecking}
                    hiddenLowScoreCount={hiddenLowScoreCount}
                    hiddenStaleCount={hiddenStaleCount}
                    hiddenSpamCount={hiddenSpamCount}
                    showAllScores={effectiveShowAll}
                    autoShowAll={autoShowAll}
                    showStale={showStale}
                    showSpam={showSpam}
                    onToggleScores={() => setShowAllScores((v) => !v)}
                    onToggleStale={() => setShowStale((v) => !v)}
                    onToggleSpam={() => setShowSpam((v) => !v)}
                  />
                  )}
                </div>
              </div>
            )}

            {view === "map" && (
              <ApartmentMap
                listings={mapListings}
                savedIds={savedIdSet}
                config={mapConfig}
                hoveredId={hoveredId}
                onMarkerClick={handleMarkerClick}
                height={680}
              />
            )}
          </>
        ) : null}
      </main>

      <Footer />
    </div>
  )
}

function ViewToggle({ view, onChange, savedCount }: { view: ViewMode; onChange: (v: ViewMode) => void; savedCount: number }) {
  const opts: { value: ViewMode; label: string; icon: React.ReactNode }[] = [
    { value: "list", label: "List", icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>
    )},
    { value: "map", label: "Map", icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Z"/><line x1="9" y1="4" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="20"/></svg>
    )},
    { value: "saved", label: savedCount > 0 ? `Saved ${savedCount}` : "Saved", icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
    )},
  ]
  return (
    <div className="inline-flex p-1 rounded-xl shrink-0" style={{ backgroundColor: Z.bgCard, border: `1px solid ${Z.border}` }}>
      {opts.map((o) => {
        const active = view === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-sm font-semibold transition-colors"
            style={{
              backgroundColor: active ? Z.blue : "transparent",
              color: active ? "white" : Z.textMid,
              fontFamily: FONT_HEADING,
            }}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
