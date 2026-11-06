/**
 * Server-only reads of the published data. On the deployment that is the Blob
 * store the webhooks write to, kept in memory for a minute per server
 * instance, so a new version appears within a minute of being published.
 * Without Blob, or for a company not in it yet, the pages read the data/
 * folder shipped with the app.
 */
import "server-only";

import { readCoverageConfig, readProfiles, readPublishedSheet, type CompanyProfile } from "../store";
import { fileStorage, storage } from "../storage";
import type { SheetData } from "./types";

export interface Coverage {
  sheets: SheetData[];
  profiles: Record<string, CompanyProfile>;
  asOf: string | null;
}

const REVALIDATE_SECONDS = 60;

async function bundled<T>(path: string): Promise<T | null> {
  const text = await fileStorage().get(path);
  return text === null ? null : (JSON.parse(text) as T);
}

// A plain in-memory cache: Next's data cache would also keep the Blob SDK's own fetch, and serve it stale.
const memo = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < REVALIDATE_SECONDS * 1000) return hit.value as Promise<T>;
  const value = load().catch((error) => {
    memo.delete(key);
    throw error;
  });
  memo.set(key, { at: Date.now(), value });
  return value;
}

const sheetFor = (ticker: string) =>
  cached(`sheet:${ticker}`, async () => (await readPublishedSheet(ticker)) ?? (storage().name === "blob" ? bundled<SheetData>(`data/sheets/${ticker}.json`) : null));

const profiles = () =>
  cached("profiles", async () => {
    const stored = await readProfiles();
    return Object.keys(stored).length ? stored : ((await bundled<Record<string, CompanyProfile>>("data/profiles.json")) ?? {});
  });

export async function loadCoverage(): Promise<Coverage> {
  const { companies } = readCoverageConfig();
  const [sheets, profileMap] = await Promise.all([Promise.all(companies.map((c) => sheetFor(c.ticker))), profiles()]);
  const published = sheets.filter((s): s is SheetData => s !== null);
  const asOf = published.map((s) => s.asOf).sort().at(-1) ?? null;
  return { sheets: published, profiles: profileMap, asOf };
}

export async function loadSheet(ticker: string): Promise<SheetData | null> {
  const t = ticker.toUpperCase();
  if (!readCoverageConfig().companies.some((c) => c.ticker === t)) return null;
  return sheetFor(t);
}
