/**
 * File store for pipeline state.
 *
 *   data/      what the pages read: published sheets and company profiles (tracked)
 *   output/    everything else: raw API responses, the pipeline's full copy of each
 *              sheet, earlier versions, the publish log, call-day records, held
 *              drafts and monitor IDs (gitignored)
 *
 * Paths resolve from the app root, so scripts, tests and route handlers agree.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { CallDayRecord, Company, CoverageIndex, SheetData } from "./lib/types";
import { publicSheet } from "./sheet/public";

export const APP_ROOT = resolve(process.env.SAID_DONE_ROOT ?? process.cwd());
const DATA = join(APP_ROOT, "data");
const OUTPUT = join(APP_ROOT, "output");

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function readCoverageConfig(): { windowStart: string; companies: Company[] } {
  const raw = readJson<{ window_start: string; companies: Company[] }>(join(APP_ROOT, "config/companies.json"));
  if (!raw) throw new Error("config/companies.json is missing");
  return { windowStart: raw.window_start, companies: raw.companies };
}

export function companyFor(ticker: string): Company {
  const company = readCoverageConfig().companies.find((c) => c.ticker === ticker.toUpperCase());
  if (!company) throw new Error(`${ticker} is not in config/companies.json`);
  return company;
}

/* Raw API responses: kept verbatim so sheets can be rebuilt without new calls. */

export type RawKind = "manifest" | "sheet-run" | "update-run" | "fills" | "search" | "extract" | "images" | "monitor-event" | "profile" | "trail-run" | "check-run" | "resolve-run";

export function writeRaw(ticker: string, kind: RawKind, id: string, payload: unknown) {
  writeJson(join(OUTPUT, "raw", ticker, `${kind}-${id}.json`), payload);
}

export function readRaw<T>(ticker: string, kind: RawKind, id: string): T | null {
  return readJson<T>(join(OUTPUT, "raw", ticker, `${kind}-${id}.json`));
}

export function listRaw(ticker: string, kind: RawKind): string[] {
  const dir = join(OUTPUT, "raw", ticker);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${kind}-`) && f.endsWith(".json"))
    .map((f) => f.slice(kind.length + 1, -5));
}

/*
 * Sheets. The pipeline reads and writes its full copy in output/sheets/, which
 * keeps the request IDs that chain update runs. Every write also publishes the
 * copy the pages read to data/sheets/, without those IDs (src/sheet/public.ts).
 */

/** The pipeline's copy, or the published one when this checkout has no output/ (a fresh clone). */
export function readSheet(ticker: string): SheetData | null {
  return readJson<SheetData>(join(OUTPUT, "sheets", `${ticker}.json`)) ?? readPublishedSheet(ticker);
}

/** What the pages read. */
export function readPublishedSheet(ticker: string): SheetData | null {
  return readJson<SheetData>(join(DATA, "sheets", `${ticker}.json`));
}

export function writeSheet(sheet: SheetData) {
  const previous = readSheet(sheet.ticker);
  if (previous && previous.version !== sheet.version) {
    writeJson(join(OUTPUT, "versions", `${sheet.ticker}.v${previous.version}.json`), previous);
  }
  writeJson(join(OUTPUT, "sheets", `${sheet.ticker}.json`), sheet);
  writeJson(join(DATA, "sheets", `${sheet.ticker}.json`), publicSheet(sheet));
}

export function writeDraft(sheet: SheetData, label: string) {
  writeJson(join(OUTPUT, "drafts", `${sheet.ticker}-${label}.json`), sheet);
}

export function readIndex(): CoverageIndex | null {
  return readJson<CoverageIndex>(join(OUTPUT, "index.json"));
}

export function writeIndex(index: CoverageIndex) {
  writeJson(join(OUTPUT, "index.json"), index);
}

/* Call-day records. */

export function callDayPath(ticker: string, callDate: string) {
  return join(OUTPUT, "callday", `${ticker}-${callDate}.json`);
}

export function readCallDay(ticker: string, callDate: string): CallDayRecord | null {
  return readJson<CallDayRecord>(callDayPath(ticker, callDate));
}

export function writeCallDay(record: CallDayRecord) {
  writeJson(callDayPath(record.ticker, record.callDate), record);
}

export function listCallDays(): CallDayRecord[] {
  const dir = join(OUTPUT, "callday");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<CallDayRecord>(join(dir, f)))
    .filter((r): r is CallDayRecord => r !== null)
    .sort((a, b) => (a.callDate < b.callDate ? 1 : -1));
}

/* Monitors: live IDs stay out of version control. */

export interface MonitorRecord {
  ticker: string;
  monitorId: string;
  spec: string;
  query: string;
  frequency: string;
  processor: string;
  createdAt: string;
  /** Monitor events already handled, so webhook retries and polls are idempotent. */
  handledEventIds: string[];
}

export function readMonitors(): MonitorRecord[] {
  return readJson<MonitorRecord[]>(join(OUTPUT, "monitors.json")) ?? [];
}

export function writeMonitors(records: MonitorRecord[]) {
  writeJson(join(OUTPUT, "monitors.json"), records);
}

/* Sheet runs in flight, so a scheduled poll never starts a second run for the same company. */

export interface PendingRun {
  ticker: string;
  groupId: string;
  startedAt: string;
}

export function readPending(): PendingRun[] {
  return readJson<PendingRun[]>(join(OUTPUT, "pending-sheets.json")) ?? [];
}

export function writePending(runs: PendingRun[]) {
  writeJson(join(OUTPUT, "pending-sheets.json"), runs);
}

/* Company profiles: GICS sector and industry from a small Task run, for the directory filters. */

export interface CompanyProfile {
  sector: string;
  industry: string;
  spec: string;
}

export function readProfiles(): Record<string, CompanyProfile> {
  return readJson<Record<string, CompanyProfile>>(join(DATA, "profiles.json")) ?? {};
}

export function writeProfiles(profiles: Record<string, CompanyProfile>) {
  writeJson(join(DATA, "profiles.json"), profiles);
}
