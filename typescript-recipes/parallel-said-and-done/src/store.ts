/**
 * Pipeline state, read and written through src/storage.ts (local files, or a
 * private Vercel Blob store on the deployment). Same layout in both:
 *
 *   data/      what the pages read: published sheets and company profiles
 *   output/    everything else: raw API responses, the pipeline's full copy of each
 *              sheet, earlier versions, runs in flight, call-day records, held
 *              drafts, monitor records and locks
 *
 * config/companies.json is code, not state: it ships with the app and is read from disk.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CallDayRecord, Company, CoverageIndex, SheetData } from "./lib/types";
import { publicSheet } from "./sheet/public";
import { APP_ROOT, storage } from "./storage";

export { APP_ROOT };

async function readJson<T>(path: string): Promise<T | null> {
  const text = await storage().get(path);
  return text === null ? null : (JSON.parse(text) as T);
}

async function writeJson(path: string, value: unknown) {
  await storage().put(path, `${JSON.stringify(value, null, 2)}\n`);
}

/* Coverage: which companies. */

export function readCoverageConfig(): { windowStart: string; companies: Company[] } {
  const path = join(APP_ROOT, "config/companies.json");
  if (!existsSync(path)) throw new Error("config/companies.json is missing");
  const raw = JSON.parse(readFileSync(path, "utf8")) as { window_start: string; companies: Company[] };
  return { windowStart: raw.window_start, companies: raw.companies };
}

export function companyFor(ticker: string): Company {
  const company = readCoverageConfig().companies.find((c) => c.ticker === ticker.toUpperCase());
  if (!company) throw new Error(`${ticker} is not in config/companies.json`);
  return company;
}

/* Raw API responses: kept verbatim so sheets can be rebuilt without new calls. */

export type RawKind = "manifest" | "sheet-run" | "update-run" | "fills" | "search" | "extract" | "images" | "monitor-event" | "profile-run" | "trail-run" | "check-run" | "resolve-run";

const rawPath = (ticker: string, kind: RawKind, id: string) => `output/raw/${ticker}/${kind}-${id}.json`;

export async function writeRaw(ticker: string, kind: RawKind, id: string, payload: unknown) {
  await writeJson(rawPath(ticker, kind, id), payload);
}

export async function readRaw<T>(ticker: string, kind: RawKind, id: string): Promise<T | null> {
  return readJson<T>(rawPath(ticker, kind, id));
}

export async function listRaw(ticker: string, kind: RawKind): Promise<string[]> {
  const prefix = `output/raw/${ticker}/${kind}-`;
  return (await storage().list(prefix)).filter((p) => p.endsWith(".json")).map((p) => p.slice(prefix.length, -5));
}

/*
 * Sheets. The pipeline reads and writes its full copy in output/sheets/, which
 * keeps the request IDs that chain update runs. Every write also publishes the
 * copy the pages read to data/sheets/, without those IDs (src/sheet/public.ts).
 */

/** The pipeline's copy, or the published one when there is no output/ (a fresh clone). */
export async function readSheet(ticker: string): Promise<SheetData | null> {
  return (await readJson<SheetData>(`output/sheets/${ticker}.json`)) ?? readPublishedSheet(ticker);
}

/** What the pages read. */
export async function readPublishedSheet(ticker: string): Promise<SheetData | null> {
  return readJson<SheetData>(`data/sheets/${ticker}.json`);
}

export async function writeSheet(sheet: SheetData) {
  const previous = await readSheet(sheet.ticker);
  if (previous && previous.version !== sheet.version) {
    await writeJson(`output/versions/${sheet.ticker}.v${previous.version}.json`, previous);
  }
  await writeJson(`output/sheets/${sheet.ticker}.json`, sheet);
  await writeJson(`data/sheets/${sheet.ticker}.json`, publicSheet(sheet));
}

export async function writeDraft(sheet: SheetData, label: string) {
  await writeJson(`output/drafts/${sheet.ticker}-${label}.json`, sheet);
}

export async function readIndex(): Promise<CoverageIndex | null> {
  return readJson<CoverageIndex>("output/index.json");
}

export async function writeIndex(index: CoverageIndex) {
  await writeJson("output/index.json", index);
}

/* Call-day records. */

function callDayPath(ticker: string, date: string, eventId?: string | null) {
  const suffix = eventId ? `-event-${encodeURIComponent(eventId)}` : "";
  return `output/callday/${ticker}-${date}${suffix}.json`;
}

export async function readCallDay(ticker: string, date: string, eventId?: string | null): Promise<CallDayRecord | null> {
  if (eventId) {
    const record = await readJson<CallDayRecord>(callDayPath(ticker, date, eventId));
    if (record) return record;
  }
  const legacy = await readJson<CallDayRecord>(callDayPath(ticker, date));
  if (legacy?.kind === "event") return legacy.trigger.eventId === eventId ? legacy : null;
  return eventId ? null : legacy;
}

export async function writeCallDay(record: CallDayRecord) {
  const base = callDayPath(record.ticker, record.callDate);
  const legacy = await readJson<CallDayRecord>(base);
  if (legacy?.kind === "event" && legacy.trigger.eventId) {
    await writeJson(callDayPath(record.ticker, record.callDate, legacy.trigger.eventId), legacy);
    await storage().del(base);
  }
  await writeJson(callDayPath(record.ticker, record.callDate, record.kind === "event" ? record.trigger.eventId : null), record);
}

export async function listCallDays(): Promise<CallDayRecord[]> {
  const paths = (await storage().list("output/callday/")).filter((p) => p.endsWith(".json"));
  const records = await Promise.all(paths.map((p) => readJson<CallDayRecord>(p)));
  return records.filter((r): r is CallDayRecord => r !== null).sort((a, b) => (a.callDate < b.callDate ? 1 : -1));
}

/* Task runs in flight, per company. Every run this app starts is recorded here until its result is handled. */

export interface InflightRun {
  kind: "sheet-run" | "update-run" | "trail-run" | "check-run" | "resolve-run" | "profile-run";
  spec: string;
  promise?: string;
  startedAt: string;
  /** Times handling its result failed; it is dropped after three. */
  attempts?: number;
}

export async function readInflight(ticker: string): Promise<Record<string, InflightRun>> {
  return (await readJson<Record<string, InflightRun>>(`output/inflight/${ticker}.json`)) ?? {};
}

export async function writeInflight(ticker: string, runs: Record<string, InflightRun>) {
  await writeJson(`output/inflight/${ticker}.json`, runs);
}

/* Monitors: one record per company, so events for different companies never contend. */

export interface MonitorRecord {
  ticker: string;
  monitorId: string;
  spec: string;
  query: string;
  frequency: string;
  processor: string;
  createdAt: string;
  /** The webhook the monitor reports to, if any. */
  webhookUrl?: string | null;
  /** Set by `pnpm monitors cancel`; a cancelled monitor is not recreated. */
  cancelledAt?: string | null;
  /** Monitor events already handled, so webhook retries, reconciles and polls are idempotent. */
  handledEventIds: string[];
}

export async function readMonitor(ticker: string): Promise<MonitorRecord | null> {
  return readJson<MonitorRecord>(`output/monitors/${ticker}.json`);
}

export async function readMonitors(): Promise<MonitorRecord[]> {
  const paths = (await storage().list("output/monitors/")).filter((p) => p.endsWith(".json"));
  const records = await Promise.all(paths.map((p) => readJson<MonitorRecord>(p)));
  return records.filter((r): r is MonitorRecord => r !== null).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export async function writeMonitor(record: MonitorRecord) {
  await writeJson(`output/monitors/${record.ticker}.json`, record);
}

/* Company profiles: GICS sector and industry from a small Task run, for the directory filters. */

export interface CompanyProfile {
  sector: string;
  industry: string;
  spec: string;
}

export async function readProfiles(): Promise<Record<string, CompanyProfile>> {
  return (await readJson<Record<string, CompanyProfile>>("data/profiles.json")) ?? {};
}

export async function writeProfiles(profiles: Record<string, CompanyProfile>) {
  await writeJson("data/profiles.json", profiles);
}

/*
 * Locks. Webhooks for the same company can arrive together (five history runs
 * finishing within seconds). Each handler takes the company's lock first, so
 * state changes happen one at a time. A lock is a file created only if absent;
 * one left behind by a crashed handler expires.
 */

const LOCK_TTL_MS = 15 * 60_000;

export async function withLock<T>(key: string, fn: () => Promise<T>, options: { waitMs?: number } = {}): Promise<T> {
  const path = `output/locks/${key}.json`;
  const deadline = Date.now() + (options.waitMs ?? 10 * 60_000);
  for (;;) {
    if (await storage().put(path, JSON.stringify({ at: new Date().toISOString() }), { create: true })) break;
    const held = await readJson<{ at: string }>(path).catch(() => null);
    if (held && Date.now() - new Date(held.at).getTime() > LOCK_TTL_MS) {
      await storage().del(path);
      continue;
    }
    if (Date.now() > deadline) throw new Error(`${key} is busy; try again later`);
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
  }
  try {
    return await fn();
  } finally {
    await storage().del(path);
  }
}
