// Listing-source configuration shared by the source picker UI and the search
// API routes. Selected sources are *includes* — sites to make sure the search
// covers, layered on top of a normal broad web search, not an exclusive
// allowlist.

export type SourceOption = { domain: string; label: string }

// The ~10 majors offered as picker chips. zillow.com / apartments.com / yelp
// are intentionally absent — they're in BLOCKED_DOMAINS (aggregators whose
// listings go stale and whose pages resist extraction).
export const MAJOR_SOURCES: SourceOption[] = [
  { domain: "craigslist.org", label: "Craigslist" },
  { domain: "redfin.com", label: "Redfin" },
  { domain: "trulia.com", label: "Trulia" },
  { domain: "hotpads.com", label: "HotPads" },
  { domain: "zumper.com", label: "Zumper" },
  { domain: "padmapper.com", label: "PadMapper" },
  { domain: "rentcafe.com", label: "RentCafe" },
  { domain: "rent.com", label: "Rent.com" },
  { domain: "realtor.com", label: "Realtor.com" },
  { domain: "compass.com", label: "Compass" },
]

export const ALL_MAJOR_DOMAINS = MAJOR_SOURCES.map((s) => s.domain)

// Normalize free-text user input ("https://www.example.com/rentals", "Example.COM")
// to a bare registrable-ish hostname; null when it can't be one. Custom domains
// are echoed into the FindAll prompt, so reject anything that isn't a clean
// hostname.
export function sanitizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // strip scheme
  s = s.split(/[/?#]/)[0] // strip path
  s = s.replace(/^www\./, "")
  s = s.replace(/:\d+$/, "") // strip port
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null
  if (s.length > 100) return null
  return s
}
