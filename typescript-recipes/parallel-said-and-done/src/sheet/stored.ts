/**
 * Stored state for one sheet: which runs it is built from (the manifest), the
 * rebuild from stored responses, and publishing to the home page.
 *
 * `rebuild` makes no API calls: every sheet in data/ can be re-derived from
 * output/raw after a rule change with `pnpm rebuild`.
 */
import type { CoverageIndex, PublishedEntry, SheetData } from "../lib/types";
import type { StoredRun } from "../parallel/task";
import { companyFor, readCoverageConfig, readIndex, readRaw, writeIndex, writeRaw, writeSheet } from "../store";
import { buildSheet, type ScheduledCall } from "./build";
import type { FillRecord } from "./fill";
import { picksFrom, type ImagesRecord } from "./images";
import { SHEET_PROCESSOR, SHEET_SPEC_KEY } from "./spec";

export interface Manifest {
  sheetRunId: string;
  taskGroupId: string | null;
  /** Held update runs stay listed for the record but are left out of every build. */
  updates: { runId: string; callDate: string; eventId: string | null; status?: "held" | "published" }[];
  images: boolean;
  /** Latest earnings_call_scheduled event still ahead of the sheet's latest call. */
  schedule?: ScheduledCall | null;
  /** Version published before this sheet run, so a fresh run continues the numbering. */
  baseVersion?: number;
  /** Stage 2 and 3 runs by promise id. A new history run clears that promise's check. */
  trails?: Record<string, string>;
  /** One fact-check run per promise, or several when a dispute was put to a vote. */
  checks?: Record<string, string | string[]>;
  /** A resolution run per disputed promise, and the checks that disputed it (kept for provenance). */
  resolves?: Record<string, string>;
  disputed?: Record<string, string | string[]>;
}

export function readManifest(ticker: string): Manifest | null {
  return readRaw<Manifest>(ticker, "manifest", "latest");
}

export function writeManifest(ticker: string, manifest: Manifest) {
  writeRaw(ticker, "manifest", "latest", manifest);
}

export function readFills(ticker: string, runIds: string[]): FillRecord[] {
  return runIds.flatMap((id) => readRaw<FillRecord[]>(ticker, "fills", id) ?? []);
}

export function appendFills(ticker: string, runId: string, records: FillRecord[]) {
  const existing = readRaw<FillRecord[]>(ticker, "fills", runId) ?? [];
  writeRaw(ticker, "fills", runId, [...existing, ...records]);
}

export function sessionId(ticker: string, runId: string) {
  return `said-and-done-${ticker}-${runId}`;
}

/** Rebuilds a sheet from stored responses only. */
export function rebuild(ticker: string, builtAt = new Date().toISOString()): SheetData {
  const manifest = readManifest(ticker);
  if (!manifest) throw new Error(`No stored runs for ${ticker}; run npm run sheet -- ${ticker}`);
  const company = companyFor(ticker);
  const { windowStart } = readCoverageConfig();
  const sheetRun = readRaw<StoredRun>(ticker, "sheet-run", manifest.sheetRunId);
  if (!sheetRun?.result) throw new Error(`Sheet run ${manifest.sheetRunId} has no stored result`);
  const updates = manifest.updates
    .filter((u) => u.status !== "held")
    .map((u) => readRaw<StoredRun>(ticker, "update-run", u.runId))
    .filter((u): u is StoredRun => !!u?.result && u.result.run.status === "completed");
  const stage = (kind: "trail-run" | "check-run" | "resolve-run", ids: Record<string, string | string[]> | undefined) =>
    Object.values(ids ?? {})
      .flat()
      .map((id) => readRaw<StoredRun>(ticker, kind, id))
      .filter((r): r is StoredRun => !!r?.result && r.result.run.status === "completed");
  const trails = stage("trail-run", manifest.trails);
  const checks = stage("check-run", manifest.checks);
  const resolves = stage("resolve-run", manifest.resolves);
  const fills = readFills(ticker, [manifest.sheetRunId, ...updates.map((u) => u.run.run_id)]);
  const irUrl = ((sheetRun.result.output as { content?: { investor_relations_url?: string } }).content ?? {}).investor_relations_url ?? null;
  const images = manifest.images ? picksFrom(readRaw<ImagesRecord>(ticker, "images", "latest"), company, irUrl) : null;
  const sheet = buildSheet({ company, windowStart, sheetRun, updates, trails, resolves, checks, fills, images, schedule: manifest.schedule ?? null, version: (manifest.baseVersion ?? 0) + 1 + updates.length, builtAt });
  if (manifest.taskGroupId) sheet.runs[0].taskGroupId = manifest.taskGroupId;
  return sheet;
}

/* Publishing: the home page reads data/index.json and data/sheets/. */

export function publish(sheet: SheetData, entry: Omit<PublishedEntry, "ticker" | "version" | "publishedAt">): PublishedEntry {
  writeSheet(sheet);
  const { windowStart, companies } = readCoverageConfig();
  const index: CoverageIndex = readIndex() ?? {
    schema: "said-done.index/1",
    windowStart,
    updatedAt: "",
    order: companies.map((c) => c.ticker),
    published: [],
    build: { taskGroupId: null, processor: SHEET_PROCESSOR, spec: SHEET_SPEC_KEY, createdAt: "" },
  };
  const published: PublishedEntry = { ticker: sheet.ticker, version: sheet.version, publishedAt: new Date().toISOString(), ...entry };
  index.published = [...index.published.filter((p) => !(p.ticker === sheet.ticker && p.version === sheet.version)), published];
  index.updatedAt = published.publishedAt;
  index.order = companies.map((c) => c.ticker);
  writeIndex(index);
  return published;
}

export function recordCoverageBuild(taskGroupId: string | null, processor: string, createdAt: string) {
  const { windowStart, companies } = readCoverageConfig();
  const index: CoverageIndex = readIndex() ?? {
    schema: "said-done.index/1",
    windowStart,
    updatedAt: createdAt,
    order: companies.map((c) => c.ticker),
    published: [],
    build: { taskGroupId, processor, spec: SHEET_SPEC_KEY, createdAt },
  };
  index.build = { taskGroupId, processor, spec: SHEET_SPEC_KEY, createdAt };
  writeIndex(index);
}

