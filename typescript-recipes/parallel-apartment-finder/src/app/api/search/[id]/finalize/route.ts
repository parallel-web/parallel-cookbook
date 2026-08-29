import { NextRequest, NextResponse } from "next/server"
import { findallResult } from "@/lib/server/parallel"
import { parseCandidates, parseOptionsFrom, scoreListing, isFarFromReference } from "@/lib/server/listings"
import { geocodeAddress, geocodeNeighborhood } from "@/lib/server/geocode"
import { neighborhoodCentroid } from "@/lib/bay-area"
import { DEFAULT_BUDGET } from "@/lib/server/config"
import { TRUSTED_SOURCES } from "@/lib/server/verify"

// Geocoding runs sequentially (~1/s per Nominatim policy) for up to
// FINDALL_MATCH_LIMIT listings, so allow more than the default duration.
export const maxDuration = 60

// Final step after enrichment completes: parse everything, geocode each
// address, and return the fully scored listings.
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
  const city = sp.get("city")

  try {
    const candidates = await findallResult(id)
    const opts = parseOptionsFrom(sp)
    const drops: Record<string, number> = {}
    const listings = parseCandidates(candidates, minBeds, budget, opts, drops)
    // Funnel visibility (shows in Vercel runtime logs): how many matched
    // candidates became listings, and why the rest were dropped.
    console.log(`[funnel] run=${id} matched=${candidates.length} kept=${listings.length} drops=${JSON.stringify(drops)}`)

    // Geocode with a precision ladder: exact address via Nominatim, then the
    // preloaded Bay Area neighborhood-centroid table (free), then Nominatim
    // for neighborhoods the table doesn't know (memoized per run), then give
    // up and let scoring treat the location as unknown-neutral.
    const nominatimPause = () => new Promise((r) => setTimeout(r, 1050))
    const hoodCache = new Map<string, { lat: number; lng: number } | null>()
    // Slow geocodes (Nominatim timeouts) must not blow the route's
    // maxDuration — past the deadline, remaining listings score as
    // unknown-location instead of failing the whole finalize.
    const deadline = Date.now() + 45_000
    for (const l of listings) {
      let coords: { lat: number; lng: number } | null = null
      const localCentroid = neighborhoodCentroid(city, l.neighborhood)
      if (l.address && Date.now() < deadline) {
        coords = await geocodeAddress(l.address, city)
        await nominatimPause()
      }
      if (coords) {
        l.geo_precision = "address"
      } else if (localCentroid) {
        coords = localCentroid
        l.geo_precision = "neighborhood"
      } else if (l.neighborhood && Date.now() < deadline) {
        const key = l.neighborhood.toLowerCase().trim()
        if (!hoodCache.has(key)) {
          hoodCache.set(key, await geocodeNeighborhood(l.neighborhood, city))
          await nominatimPause()
        }
        coords = hoodCache.get(key) ?? null
        if (coords) l.geo_precision = "neighborhood"
      }
      if (coords) {
        l.lat = coords.lat
        l.lng = coords.lng
      }
      l.score = scoreListing(l, budget, opts) // re-score with geo precision known
    }

    // Drop listings that geocoded well outside the search's region (a same-state
    // unit that shares a street name, so the address/URL guard didn't catch it).
    // Failed-geocode listings have null coords and are kept.
    const inRegion = listings.filter((l) => !isFarFromReference(l.lat, l.lng, opts))
    if (inRegion.length !== listings.length) {
      console.log(`[funnel] run=${id} dropped ${listings.length - inRegion.length} out-of-region`)
    }

    // Flag untrusted-source listings for the client-driven Task API
    // secondary verification (same flags as the original spam check).
    const withVerify = inRegion.map((l) => ({
      ...l,
      needs_verification: !TRUSTED_SOURCES.has(l.source),
    }))
    return NextResponse.json({ listings: withVerify })
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "finalize failed" }, { status: 502 },
    )
  }
}
