import { isIndividualListingUrl } from "./listing-url"

/**
 * Return `url` only if it is a safe http(s) link, otherwise `fallback`.
 * Listing and citation URLs are scraped/LLM-extracted (untrusted); React
 * does not block `javascript:`/`data:` hrefs, so we allow-list schemes here.
 */
export function safeUrl(url: string | null | undefined, fallback = "#"): string {
  if (!url) return fallback
  try {
    const u = new URL(url, "https://example.invalid")
    return u.protocol === "http:" || u.protocol === "https:" ? url : fallback
  } catch {
    return fallback
  }
}

/**
 * Pick the outbound link for a listing. Always resolve to a specific listing
 * page — never a top-level domain / homepage, and never a search/category
 * index: prefer the listing URL, then the first citation that is itself an
 * individual listing page, and only fall back (e.g. to an address search)
 * when no real listing page exists.
 */
// How specific a listing URL is: deeper paths and an id-like (numeric) segment
// mean "an actual unit" vs a shallow geo/browse page (…/mission-san-francisco-ca).
function urlSpecificity(u: string): number {
  try {
    const segs = new URL(u).pathname.split("/").filter(Boolean)
    return segs.length + (segs.some((s) => /\d/.test(s)) ? 2 : 0)
  } catch {
    return 0
  }
}

export function pickSourceUrl(
  url: string | null | undefined,
  citations: { url: string }[] | null | undefined,
  fallback = "#",
): string {
  // Consider the listing URL and every citation; keep only real individual
  // listing links, then pick the MOST SPECIFIC one. This avoids linking to a
  // shallow browse/landing page (which passes the "deep" check) when a precise
  // unit link is available among the citations. Ties keep the earliest (the
  // listing URL first), so behavior is stable.
  const candidates = [url, ...(citations ?? []).map((c) => c.url)].filter(isIndividualListingUrl) as string[]
  if (!candidates.length) return fallback
  let best = candidates[0]
  let bestScore = urlSpecificity(best)
  for (const c of candidates.slice(1)) {
    const s = urlSpecificity(c)
    if (s > bestScore) { best = c; bestScore = s }
  }
  return best
}

/** Escape a string for safe interpolation into a raw HTML string. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
