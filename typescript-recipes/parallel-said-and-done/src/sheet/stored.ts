/**
 * Stored state for one sheet: which runs it is built from (the manifest), the
 * rebuild from stored responses, and publishing to the home page.
 *
 * `rebuild` makes no API calls: every sheet in data/ can be re-derived from
 * output/raw after a rule change with `pnpm rebuild`.
 */
import type { CoverageIndex, PublishedEntry, SheetData } from "../lib/types";
import type { StoredRun } from "../parallel/task";
import { companyFor, readCoverageConfig, readIndex, readRaw, readSheet, writeIndex, writeRaw, writeSheet } from "../store";
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
  /** Failed stage 2 and 3 runs by "kind:promise"; a step that failed twice is not retried automatically. */
  failures?: Record<string, number>;
}

export async function readManifest(ticker: string): Promise<Manifest | null> {
  return readRaw<Manifest>(ticker, "manifest", "latest");
}

export async function publishedManifest(ticker: string): Promise<Manifest | null> {
  const m = await readManifest(ticker);
  return m && (await readSheet(ticker))?.runs[0]?.runId === m.sheetRunId ? m : null;
}

export async function writeManifest(ticker: string, manifest: Manifest) {
  await writeRaw(ticker, "manifest", "latest", manifest);
}

export async function readFills(ticker: string, runIds: string[]): Promise<FillRecord[]> {
  return (await Promise.all(runIds.map((id) => readRaw<FillRecord[]>(ticker, "fills", id)))).flatMap((f) => f ?? []);
}

export async function appendFills(ticker: string, runId: string, records: FillRecord[]) {
  if (!records.length) return;
  const existing = (await readRaw<FillRecord[]>(ticker, "fills", runId)) ?? [];
  await writeRaw(ticker, "fills", runId, [...existing, ...records]);
}

export function sessionId(ticker: string, runId: string) {
  return `said-and-done-${ticker}-${runId}`;
}

/** Rebuilds a sheet from stored responses only. */
export async function rebuild(ticker: string, builtAt = new Date().toISOString(), candidateRunId?: string): Promise<SheetData> {
  const manifest = await readManifest(ticker);
  if (!manifest) throw new Error(`No stored runs for ${ticker}; run pnpm sheet ${ticker}`);
  const company = companyFor(ticker);
  const { windowStart } = readCoverageConfig();
  const done = (r: StoredRun | null): r is StoredRun => !!r?.result && r.result.run.status === "completed";
  const stage = async (kind: "trail-run" | "check-run" | "resolve-run", ids: Record<string, string | string[]> | undefined) =>
    (await Promise.all(Object.values(ids ?? {}).flat().map((id) => readRaw<StoredRun>(ticker, kind, id)))).filter(done);
  const prior = manifest.updates.some(u => !u.status) ? await readSheet(ticker) : null;
  const included = manifest.updates.filter(u => u.status === "published" || u.runId === candidateRunId ||
    (!u.status && prior?.runs.some(r => r.kind === "update" && r.runId === u.runId)));
  const [sheetRun, updateRuns, trails, checks, resolves, imagesRecord] = await Promise.all([
    readRaw<StoredRun>(ticker, "sheet-run", manifest.sheetRunId),
    Promise.all(included.map((u) => readRaw<StoredRun>(ticker, "update-run", u.runId))),
    stage("trail-run", manifest.trails),
    stage("check-run", manifest.checks),
    stage("resolve-run", manifest.resolves),
    manifest.images ? readRaw<ImagesRecord>(ticker, "images", "latest") : Promise.resolve(null),
  ]);
  if (!sheetRun?.result) throw new Error(`Sheet run ${manifest.sheetRunId} has no stored result`);
  const updates = updateRuns.filter(done);
  const fills = await readFills(ticker, [manifest.sheetRunId, ...updates.map((u) => u.run.run_id)]);
  const irUrl = ((sheetRun.result.output as { content?: { investor_relations_url?: string } }).content ?? {}).investor_relations_url ?? null;
  const images = manifest.images ? picksFrom(imagesRecord, company, irUrl) : null;
  const sheet = buildSheet({ company, windowStart, sheetRun, updates, trails, resolves, checks, fills, images, schedule: manifest.schedule ?? null, version: (manifest.baseVersion ?? 0) + 1 + updates.length, builtAt });
  if (manifest.taskGroupId) sheet.runs[0].taskGroupId = manifest.taskGroupId;
  return sheet;
}

/* Publishing: the pages read data/sheets/; output/index.json logs every published version. */

export async function publish(sheet: SheetData, entry: Omit<PublishedEntry, "ticker" | "version" | "publishedAt">): Promise<PublishedEntry> {
  await writeSheet(sheet);
  const { windowStart, companies } = readCoverageConfig();
  const index: CoverageIndex = (await readIndex()) ?? {
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
  await writeIndex(index);
  return published;
}
