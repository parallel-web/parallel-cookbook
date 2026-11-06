/**
 * Server-only reads of the published data. On the deployment that is the Blob
 * store the webhooks write to, cached for a minute, so a new version appears
 * within a minute of being published. Without Blob, or for a company not in
 * it yet, the pages read the data/ folder shipped with the app.
 */
import "server-only";

import { unstable_cache } from "next/cache";

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

const sheetFor = (ticker: string) =>
  unstable_cache(
    async () => (await readPublishedSheet(ticker)) ?? (storage().name === "blob" ? bundled<SheetData>(`data/sheets/${ticker}.json`) : null),
    ["sheet", ticker],
    { revalidate: REVALIDATE_SECONDS, tags: ["sheets"] },
  )();

const profiles = unstable_cache(
  async () => {
    const stored = await readProfiles();
    return Object.keys(stored).length ? stored : ((await bundled<Record<string, CompanyProfile>>("data/profiles.json")) ?? {});
  },
  ["profiles"],
  { revalidate: REVALIDATE_SECONDS, tags: ["sheets"] },
);

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
