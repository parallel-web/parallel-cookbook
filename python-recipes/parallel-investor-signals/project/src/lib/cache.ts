// Session cache for successful briefs (localStorage). Two jobs:
//   1. During a live call, re-running a lookup is INSTANT (with an honest
//      "cached" badge + one-click live refresh).
//   2. The "Recent" chips under the search bar double as a quick-jump menu —
//      pre-warm a few accounts before a call, then demo them instantly.
// Capped small; this is a convenience, not a datastore.
import type { Depth, ResearchBrief } from "../types";

const KEY = "pse-brief-cache-v1";
const MAX_ENTRIES = 10;

export interface CachedBrief {
  cacheKey: string;
  query: string;
  depth: Depth;
  savedAt: number; // epoch ms
  brief: ResearchBrief;
}

function cacheKey(query: string, depth: Depth): string {
  return `${query.trim().toLowerCase()}|${depth}`;
}

function readAll(): CachedBrief[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CachedBrief[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: CachedBrief[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage full/blocked — cache is best-effort */
  }
}

export function getCached(query: string, depth: Depth): CachedBrief | null {
  const k = cacheKey(query, depth);
  return readAll().find((e) => e.cacheKey === k) ?? null;
}

export function saveCached(query: string, depth: Depth, brief: ResearchBrief): void {
  const k = cacheKey(query, depth);
  const rest = readAll().filter((e) => e.cacheKey !== k);
  writeAll([{ cacheKey: k, query: query.trim(), depth, savedAt: Date.now(), brief }, ...rest]);
}

// Most-recent-first list of distinct queries for the "Recent" chips.
export function recentQueries(limit = 5): { query: string; depth: Depth }[] {
  const seen = new Set<string>();
  const out: { query: string; depth: Depth }[] = [];
  for (const e of readAll()) {
    const q = e.query.toLowerCase();
    if (seen.has(q)) continue;
    seen.add(q);
    out.push({ query: e.query, depth: e.depth });
    if (out.length >= limit) break;
  }
  return out;
}

export function agoLabel(savedAt: number): string {
  const s = Math.max(1, Math.round((Date.now() - savedAt) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
