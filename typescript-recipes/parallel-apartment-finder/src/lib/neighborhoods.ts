// Query-time neighborhood parsing against the preloaded Bay Area tables
// (lib/bay-area.ts). Matched names show as "Parsed" chips and are passed to
// the FindAll objective as a priority hint.

import { cityByName } from "./bay-area"

function neighborhoodsForCity(city: string): string[] {
  return cityByName(city)?.neighborhoods.map((n) => n.name) ?? []
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Returns the known neighborhoods mentioned in the query, in query order,
// deduped case-insensitively.
export function extractNeighborhoodsFromQuery(query: string, city: string): string[] {
  const list = neighborhoodsForCity(city)
  if (!list.length || !query.trim()) return []
  const hits: { name: string; index: number }[] = []
  for (const n of list) {
    const re = new RegExp(`(?<![\\w-])${escapeRegExp(n)}(?![\\w-])`, "i")
    const m = query.match(re)
    if (m && m.index != null) hits.push({ name: n, index: m.index })
  }
  hits.sort((a, b) => a.index - b.index)
  const seen = new Set<string>()
  return hits.filter((h) => {
    const k = h.name.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).map((h) => h.name)
}
