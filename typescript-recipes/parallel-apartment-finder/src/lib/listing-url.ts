// One source of truth (client + server) for telling an individual rental
// listing URL apart from a search-results / category / geo-index page.
// Individual listings carry a street address or a numeric id in the path;
// the patterns below only ever appear on list/category pages.

const SEARCH_PAGE_PATTERNS: RegExp[] = [
  /\/apartments\/$/i,
  /\/apartments-\d+-bedrooms\/$/i,
  /\/apartments-under-\d+\/$/i,
  /\/\d+-bedroom-apartments/i,
  /\/rentals$/i,
  /\/apartments\/[a-z-]+(?:\/|$)/i,
  // Explicit search-results URLs (craigslist /search/apa?query=…, generic ?q=).
  /\/search[/?#]/i,
  /[?&](?:query|q|search|searchQueryState)=/i,
  /#search/i,
  // Category / geo-index list pages on the major aggregators.
  /\/for_rent\//i,                       // Trulia/Zillow: /for_rent/San_Francisco,CA
  /\/for_sale\//i,
  /-for-rent\/?(?:[?#]|$)/i,             // …/apartments-for-rent (Redfin/HotPads)
  /\/(?:city|zipcode|neighborhood|county|state)\/\d/i, // Redfin geo indexes
  /\/apartments-for-rent\/[a-z-]+\/?$/i, // Zumper geo search: /apartments-for-rent/san-francisco-ca
  // Price-band category pages: apartmentfinder /…/Under-3000 (slash) and
  // hotpads /…/apartments-under-3000 (hyphen) — accept either separator.
  /[/-](?:under|over)-\$?\d{3,}(?:[/?#]|$)/i,
  /-apartments\/?$/i,                    // "…-Apartments" area list page
  /-apartments\/(?:under|over|cheap|luxury|pet|furnished|studio|\d)/i, // "…-Apartments/<filter>"
  /apartments-\d+-bedrooms?/i,           // zillow-style /…/apartments-2-bedrooms
  /\/\d+-bedrooms?(?:[/?#]|$)/i,          // apartments.com-style /{geo}/2-bedrooms index
  /\/shopping-centers?\//i,              // POI/directory pages (apartmenthomeliving)
  /\/find\//i,                           // forrent.com-style /find/… search paths
  /(?:less|more|under|over)-than-\$?\d{2,}/i, // price-filter search segments (…/less-than-3000)
  // Rentler city/state index pages: /places-for-rent[/{state}[/{city}]] (a
  // map of all listings). Individual units add /{street-slug}/{numeric-id}
  // beyond the city, so those deeper paths are NOT matched here.
  /\/places-for-rent(?:\/[a-z]{2}(?:\/[a-z0-9-]+)?)?\/?(?:[?#]|$)/i,
  // Facet / filter path segments. These are range/filter controls that only
  // appear on search-results pages, never on an individual unit. Scoped to the
  // range forms (min-max, price-band) so a unit slug like "2-beds-1-bath" or
  // "half-price-special" is NOT caught.
  /\/price-(?:na|\d+)-/i,                 // realtor: /price-na-800, /price-1000-3000
  /\d+k-price(?:[/?#]|$)/i,               // compass: /5k-price
  /[/-]beds-\d+-\d+/i,                    // realtor: /beds-2-2 (min-max facet)
  /[/-]from-\d{3,}(?:[/?#]|$)/i,          // apartmenthomeliving: /from-5000
  // apartments.com city index (/san-francisco-ca). Real apartments.com deep
  // links always carry a digit-led street address or a trailing id segment, so
  // a single all-lowercase-hyphen segment that ends the path is an index page.
  /apartments\.com\/[a-z-]+\/?(?:[?#]|$)/i,
]

// Aggregator hosts we never link to even if a URL looks listing-shaped —
// mirrors the server's default BLOCKED_DOMAINS so client link-picking agrees.
const BLOCKED_LINK_HOSTS = ["zillow.com", "yelp.com", "loopnet.com", "crexi.com"]

export function isSearchOrCategoryUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return SEARCH_PAGE_PATTERNS.some((p) => p.test(url))
}

/**
 * A safe, absolute http(s) URL that points at a specific page (has a path or
 * query) AND is not a search/category/index page — i.e. a real listing link.
 */
export function isIndividualListingUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url) // absolute only
    if (u.protocol !== "http:" && u.protocol !== "https:") return false
    const host = u.hostname.toLowerCase().replace(/^www\./, "")
    if (BLOCKED_LINK_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return false
    // Craigslist detail pages live under `/d/` (e.g. /view/d/<slug>/<id> or
    // /<subarea>/apa/d/<slug>/<id>.html). Their slugs often embed the search
    // terms — "…-mission-bedroom-under-3800/…" — which would otherwise trip the
    // price-band / category patterns and drop a real listing. A `/d/` path is
    // an individual unit; only `/search/` is a Craigslist index (rejected below
    // by the generic patterns since it has no `/d/`).
    if ((host === "craigslist.org" || host.endsWith(".craigslist.org")) && /\/d\//i.test(u.pathname)) {
      return true
    }
    const deep = u.pathname.replace(/\/+$/, "").length > 0 || u.search.length > 0
    return deep && !isSearchOrCategoryUrl(url)
  } catch {
    return false
  }
}
