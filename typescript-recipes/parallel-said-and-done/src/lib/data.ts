/**
 * Server-only reads of the published data in data/. Pages render whatever the
 * pipeline last published, so a sheet the monitors update appears on the next
 * request without a rebuild.
 */
import "server-only";

import { readCoverageConfig, readProfiles, readPublishedSheet, type CompanyProfile } from "../store";
import type { SheetData } from "./types";

export interface Coverage {
  sheets: SheetData[];
  profiles: Record<string, CompanyProfile>;
  asOf: string | null;
}

export function loadCoverage(): Coverage {
  const { companies } = readCoverageConfig();
  const sheets = companies.map((c) => readPublishedSheet(c.ticker)).filter((s): s is SheetData => s !== null);
  const asOf = sheets.map((s) => s.asOf).sort().at(-1) ?? null;
  return { sheets, profiles: readProfiles(), asOf };
}

export function loadSheet(ticker: string): SheetData | null {
  return readPublishedSheet(ticker.toUpperCase());
}
