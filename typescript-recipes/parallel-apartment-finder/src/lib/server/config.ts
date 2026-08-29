// Server-side configuration for the Next.js API routes. Every value is
// env-overridable.

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}
function envNum(key: string, fallback: number): number {
  const v = process.env[key]
  const n = v != null ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

export const CITY = envStr("CITY", "San Francisco, CA")
export const CITY_SHORT = envStr("CITY_SHORT", CITY.split(",")[0].trim())

export const REFERENCE_POINT_NAME = envStr("REFERENCE_POINT_NAME", "Caltrain · 4th & King")
export const REFERENCE_POINT_LAT = envNum("REFERENCE_POINT_LAT", 37.7764)
export const REFERENCE_POINT_LNG = envNum("REFERENCE_POINT_LNG", -122.3973)

export const MAP_CENTER_LAT = envNum("MAP_CENTER_LAT", REFERENCE_POINT_LAT)
export const MAP_CENTER_LNG = envNum("MAP_CENTER_LNG", REFERENCE_POINT_LNG)
export const MAP_ZOOM = envNum("MAP_ZOOM", 13)

export const DEFAULT_BUDGET = envNum("SEARCH_BUDGET", 6000)

export const LISTING_SITES = envStr(
  "LISTING_SITES",
  "trulia.com,craigslist.org,hotpads.com,rent.com," +
  "redfin.com,realtor.com,padmapper.com,rentcafe.com,zumper.com,movoto.com," +
  "rentberry.com,showcase.com,compass.com",
)

// Domain-level blocks. Kept deliberately small: category/search index pages
// are filtered precisely by URL pattern (lib/listing-url), so we no longer
// blanket-block whole aggregators. apartments.com in particular has huge,
// extractable individual-listing inventory — blocking it was silently killing
// most Bay Area results. zillow (heavy bot-walls → dead outbound links),
// yelp (not rental listings), and loopnet/crexi (commercial real estate, not
// apartments) stay blocked.
export const BLOCKED_DOMAINS = envStr("BLOCKED_DOMAINS", "zillow.com,yelp.com,loopnet.com,crexi.com")
  .split(",").map((d) => d.trim().toLowerCase()).filter(Boolean)

export const GEO_COUNTRY = envStr("GEO_COUNTRY", "us")

export const APP_TITLE = envStr("APP_TITLE", "Bay Area Apartment Finder")
export const BRAND_NAME = envStr("BRAND_NAME", "Apartment Finder")
export const BRAND_LOGO_URL = envStr("BRAND_LOGO_URL", "/app-logo.svg")

// Starter queries. Each was measured against real discovery runs before being
// listed here, because a chip that finalizes to an empty grid is the worst
// thing on the page. Two failure modes to avoid when editing:
//   - Budget at the entry-level floor. `fits_budget` is a hard FindAll match
//     condition, so pricing a chip at its RENT_FLOORS value verifies almost
//     nothing ("Studio in Palo Alto under $2,600" finalized to zero listings).
//     Aim ~1.25-1.4x the floor for that city and bedroom count.
//   - Thin inventory. Boutique neighborhoods and the smaller Peninsula/South
//     Bay cities verify candidates that are mostly category and index pages,
//     which the listing parser drops — the run ends with matches but no cards.
//     Dense cities and large neighborhoods hold up run to run.
// Spell any neighborhood exactly as lib/bay-area.ts has it so it parses to a
// 📍 chip ("UC Berkeley" does not, which is why the old chip showed none), and
// leave square footage out — it constrains discovery and slows the run.
// Last measured 2026-08-19 (parsed-candidate average over 2-4 discovery runs
// each): Mission Bay 1BR 5.0, Mission 2BR 4.5, Hayes Valley 1BR 3.5.
export const SUGGESTIONS = envStr(
  "SEARCH_SUGGESTIONS",
  "1 bedroom in Mission Bay under $5,000|" +
  "2 bedroom in the Mission under $7,000|" +
  "1 bedroom in Hayes Valley under $4,400",
).split("|").map((s) => s.trim()).filter(Boolean)

// Typical monthly-rent floors by bedroom count for the default city (SF).
// Drives the auto-budget when a query omits one, and the price-fit score.
export const RENT_FLOORS: Record<string, number> = (() => {
  const out: Record<string, number> = {}
  for (const pair of envStr("RENT_FLOORS", "0:2500,1:3400,2:4600,3:6200,4:7800,5:9500").split(",")) {
    const [k, v] = pair.split(":")
    const kn = parseInt(k?.trim() ?? "", 10)
    const vn = parseInt(v?.trim() ?? "", 10)
    if (Number.isFinite(kn) && Number.isFinite(vn)) out[kn] = vn
  }
  return out
})()

export const AGGREGATOR_SOURCES = envStr(
  "AGGREGATOR_SOURCES", "trulia,hotpads,padmapper,rentcafe,rent,showcase",
).split(",").map((s) => s.trim()).filter(Boolean)

export const STALE_AGGREGATOR_DAYS = envNum("STALE_AGGREGATOR_DAYS", 14)
export const STALE_DIRECT_DAYS = envNum("STALE_DIRECT_DAYS", 45)

// Generator tiers and match limit for an interactive search. Enrichment (a
// per-listing Task) dominates wall-clock, so the search must not block on
// enriching every match — the client caps how long it waits and finalizes with
// what's ready (see use-search).
// - Discovery uses the fast "base" generator; finding candidate URLs is easy.
// - Enrichment defaults to "base" here (see the note below). A higher tier
//   extracts pages more reliably at the cost of latency; raise it only if blank
//   price/beds listings are getting filtered out and hurting recall.
// - match_limit is set well above the number we expect to show. Funnel logs
//   show only ~15-20% of verified candidates survive parsing — the rest are
//   category/index pages, url-less entries, blocked hosts, or duplicates — so a
//   limit of ~25 yields a handful of real listings where 10 yielded ~2. Recall
//   scales with the pool (a run that verified 16 kept 6; runs that verified 10
//   kept 2). The cost is more enrichment Tasks per search; the client caps how
//   long it waits, so the extra shows up as token cost, not proportional latency.
export const FINDALL_GENERATOR = envStr("FINDALL_GENERATOR", "base")
export const FINDALL_MATCH_LIMIT = envNum("FINDALL_MATCH_LIMIT", 25)
// NOTE: production has always run "base" here (the env var is unset on Vercel
// and the old code read the env directly with a "base" fallback, ignoring this
// constant's former "core" default). Kept at "base" so cleanup changes no
// behavior; bump the env var to "core" deliberately if extraction quality
// warrants the extra latency.
export const FINDALL_ENRICH_PROCESSOR = envStr("FINDALL_ENRICH_PROCESSOR", "base")
