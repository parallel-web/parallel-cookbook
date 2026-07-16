// Saved company profiles (localStorage). This is the rep's personal dashboard
// store: a saved profile is the full ResearchBrief plus timestamps, upserted by
// company identity (the normalized query). Per-browser, best-effort — the same
// pattern as cache.ts, but user-curated rather than an LRU convenience.
import type { ResearchBrief } from "../types";

const KEY = "pse-profiles-v1";

export interface SavedProfile {
  id: string;
  query: string; // normalized identity, e.g. "ramp.com"
  savedAt: number; // first saved (epoch ms)
  updatedAt: number; // last updated (epoch ms)
  brief: ResearchBrief;
}

function norm(query: string): string {
  return query.trim().toLowerCase();
}

function readAll(): SavedProfile[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedProfile[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list: SavedProfile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full/blocked — best-effort */
  }
}

// Most-recently-updated first — the dashboard order.
export function listProfiles(): SavedProfile[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findProfile(query: string): SavedProfile | null {
  const q = norm(query);
  return readAll().find((p) => p.query === q) ?? null;
}

// Upsert by company identity: saving an already-saved company updates it in
// place (same id, savedAt preserved).
export function saveProfile(brief: ResearchBrief): SavedProfile {
  const q = norm(brief.query);
  const all = readAll();
  const existing = all.find((p) => p.query === q);
  const now = Date.now();
  const entry: SavedProfile = {
    id: existing?.id ?? (crypto.randomUUID?.() ?? `p_${now}`),
    query: q,
    savedAt: existing?.savedAt ?? now,
    updatedAt: now,
    brief,
  };
  writeAll([entry, ...all.filter((p) => p.query !== q)]);
  return entry;
}

export function deleteProfile(id: string): SavedProfile[] {
  writeAll(readAll().filter((p) => p.id !== id));
  return listProfiles();
}
