/**
 * One new earnings call, end to end:
 *
 *   startCallDay   Search finds the transcript, Extract reads it, excerpts are
 *                  matched to the tracked promises; if the sheet does not cover
 *                  the call yet, an update Task run starts, chained to the
 *                  sheet run with previous_interaction_id
 *   finishUpdate   update result → gap fills → compare with the excerpts → gate
 *                  → publish the new sheet version, or hold it in output/drafts
 */
import type { CallDayRecord, SheetData } from "../lib/types";
import type { Parallel } from "../parallel/client";
import { awaitResult, createRun, type StoredRun, type TaskRunResult } from "../parallel/task";
import { fillGaps } from "../sheet/fill";
import { evaluateUpdate } from "../sheet/gate";
import type { ScheduledCall } from "../sheet/build";
import { appendFills, publish, readFills, readManifest, rebuild, sessionId, writeManifest } from "../sheet/stored";
import { companyFor, listCallDays, readCallDay, readCoverageConfig, readRaw, readSheet, writeCallDay, writeDraft, writeRaw, writeSheet } from "../store";
import { compareWithTask, coverageOf, matchPassages, rankResults, readCall, readSource, type ExtractResponseLike, type SearchResponseLike } from "./callday";
import { companyDomains } from "../sheet/evidence";
import { UPDATE_SPEC_KEY, updateRunRequest } from "./spec";

type Log = (line: string) => void;

export function newRecord(ticker: string, callDate: string, quarter: string, trigger: CallDayRecord["trigger"]): CallDayRecord {
  return {
    schema: "said-done.callday/1",
    ticker,
    callDate,
    quarter,
    createdAt: new Date().toISOString(),
    status: "extracted",
    trigger,
    search: null,
    extract: null,
    passages: [],
    coverage: [],
    update: null,
    gate: null,
    sheetVersion: null,
  };
}

/**
 * Handles one call: Search + Extract always; an update Task run only when the
 * published sheet does not already cover the call.
 */
export async function startCallDay(
  client: Parallel,
  ticker: string,
  call: { date: string; quarter: string; kind?: "call" | "event"; url?: string },
  trigger: CallDayRecord["trigger"],
  options: { webhookUrl: string | null; wait: boolean; log: Log; forceUpdate?: boolean; redo?: boolean },
): Promise<CallDayRecord> {
  const kind = call.kind ?? "call";
  const company = companyFor(ticker);
  const sheet = readSheet(ticker);
  if (!sheet) throw new Error(`No published sheet for ${ticker}`);
  const existing = readCallDay(ticker, call.date);
  if (existing && existing.status !== "waiting_transcript" && !options.forceUpdate && !options.redo) {
    options.log(`${ticker} ${call.date}: already handled (${existing.status})`);
    return existing;
  }
  // A redo re-reads the call but keeps what triggered it (e.g. the monitor event).
  let record: CallDayRecord = existing
    ? { ...newRecord(ticker, call.date, call.quarter, existing.trigger), createdAt: existing.createdAt, kind: existing.kind ?? kind }
    : { ...newRecord(ticker, call.date, call.quarter, trigger), kind };
  const session = `said-and-done-callday-${ticker}-${call.date}`;
  const onRaw = (k: "search" | "extract", id: string, payload: unknown) => writeRaw(ticker, k, id, payload);
  // A call is found with Search; an announcement is the page the monitor cited.
  record = kind === "event" && call.url ? await readSource(client, sheet, record, call.url, session, onRaw) : await readCall(client, company, sheet, record, session, onRaw);
  options.log(`${ticker} ${call.date}: ${record.search ? `search ${record.search.id}, ` : ""}${record.status}, ${record.passages.length} excerpts from ${record.extract?.url ?? "no page"}`);
  if (record.status === "waiting_transcript") {
    writeCallDay(record);
    return record;
  }

  // A redo of a call that already had an update run re-reads the transcript only:
  // it keeps that run, its gate and the version it produced.
  if (options.redo && existing?.update && !options.forceUpdate) {
    const published = sheet.runs.some((r) => r.runId === existing.update!.runId);
    record = published ? compareWithTask(record, sheet, existing.update.runId) : record;
    record = { ...record, status: existing.status, update: existing.update, gate: existing.gate, sheetVersion: existing.sheetVersion };
    writeCallDay(record);
    return record;
  }

  const covered = kind === "call" && call.date <= sheet.latestCall.date && !options.forceUpdate;
  if (covered) {
    // The sheet run already read this call: compare excerpts with its statements, no new Task run.
    record = compareWithTask(record, sheet, null);
    record = { ...record, status: "published", sheetVersion: sheet.version };
    writeCallDay(record);
    return record;
  }

  const request = updateRunRequest(company, sheet, { date: call.date, quarter: call.quarter, transcriptUrl: record.extract?.url ?? null, kind }, options.webhookUrl);
  const stored = await createRun(client, request, UPDATE_SPEC_KEY);
  writeRaw(ticker, "update-run", stored.run.run_id, stored);
  const manifest = readManifest(ticker)!;
  writeManifest(ticker, { ...manifest, updates: [...manifest.updates, { runId: stored.run.run_id, callDate: call.date, eventId: trigger.eventId }] });
  record = { ...record, status: "updating", update: { runId: stored.run.run_id, status: stored.run.status, processor: stored.run.processor } };
  writeCallDay(record);
  options.log(`${ticker} ${call.date}: update run ${stored.run.run_id} (${stored.run.processor}) chained to ${sheet.runs.at(-1)?.interactionId}`);
  if (!options.wait) return record;
  const result = await awaitResult(client, stored.run.run_id, (s) => options.log(`${ticker}: update waiting ${s}s`));
  return (await finishUpdate(client, ticker, stored.run.run_id, result, options.log)).record;
}

export async function finishUpdate(
  client: Parallel,
  ticker: string,
  runId: string,
  result: TaskRunResult | null,
  log: Log,
): Promise<{ record: CallDayRecord; sheet: SheetData | null; published: boolean }> {
  const company = companyFor(ticker);
  const stored = readRaw<StoredRun>(ticker, "update-run", runId);
  if (!stored) throw new Error(`Unknown update run ${runId}`);
  const final = result ?? (await client.taskRun.result(runId));
  writeRaw(ticker, "update-run", runId, { ...stored, run: final.run, result: final });
  const callDate = String((stored.input as { call_date: string }).call_date);
  let record = readCallDay(ticker, callDate);
  if (!record) throw new Error(`No call-day record for ${ticker} ${callDate}`);
  if (final.run.status !== "completed") {
    record = { ...record, status: "held", update: { runId, status: final.run.status, processor: final.run.processor } };
    writeCallDay(record);
    return { record, sheet: null, published: false };
  }

  let sheet = rebuild(ticker);
  const fills = await fillGaps(client, company, sheet, readFills(ticker, [runId]), {
    runId,
    sessionId: sessionId(ticker, runId),
    log,
  });
  appendFills(ticker, runId, fills);
  sheet = rebuild(ticker);
  record = compareWithTask({ ...record, coverage: coverageOf(sheet, record.passages) }, sheet, runId);
  const gate = evaluateUpdate(sheet, record, runId);
  const passed = gate.passed && sheet.gate.passed;
  record = {
    ...record,
    gate,
    status: passed ? "published" : "held",
    update: { runId, status: final.run.status, processor: final.run.processor },
    sheetVersion: sheet.version,
  };
  for (const c of gate.checks) log(`  ${c.result.padEnd(4)} ${c.label}: ${c.detail}`);
  const manifest = readManifest(ticker)!;
  writeManifest(ticker, {
    ...manifest,
    updates: manifest.updates.map((u) => (u.runId === runId ? { ...u, status: passed ? "published" : "held" } : u)),
  });
  if (passed) {
    publish(sheet, { trigger: record.trigger.kind, callDate, monitorEventId: record.trigger.eventId });
    log(`${ticker}: published v${sheet.version} after the ${callDate} call`);
  } else {
    writeDraft(sheet, `v${sheet.version}-${callDate}`);
    log(`${ticker}: held v${sheet.version}; see output/drafts`);
  }
  writeCallDay(record);
  return { record, sheet, published: passed };
}

/** Re-derives a call-day record from its stored Search and Extract responses. No API calls. */
export function rebuildCallDay(record: CallDayRecord): CallDayRecord {
  const sheet = readSheet(record.ticker);
  if (!sheet || !record.search) return record;
  const company = companyFor(record.ticker);
  const ownDomains = companyDomains(company.website, sheet.irUrl);
  const search = readRaw<{ response: SearchResponseLike }>(record.ticker, "search", record.search.id);
  let next: CallDayRecord = record;
  if (search) next = { ...next, search: { ...record.search, results: rankResults(search.response, ownDomains, record.extract?.url ?? null) } };
  const extract = record.extract ? readRaw<{ response: ExtractResponseLike }>(record.ticker, "extract", record.extract.id) : null;
  if (extract) {
    const texts = extract.response.results.flatMap((r) => (r.full_content ? [r.full_content] : (r.excerpts ?? [])));
    const passages = matchPassages(sheet, texts);
    next = { ...next, passages, coverage: coverageOf(sheet, passages) };
  }
  // An update run that is part of the published sheet is compared with its own statements. Otherwise
  // the sheet run covers the call (e.g. a fresh sheet run after it), or a held update has nothing published.
  if (record.update && sheet.runs.some((r) => r.runId === record.update!.runId)) return compareWithTask(next, sheet, record.update.runId);
  if (!record.update || record.callDate <= sheet.latestCall.date) return compareWithTask(next, sheet, null);
  return next;
}

/**
 * Keeps the sheet's next-call date current from the monitor's scheduled-call
 * events. Same version: the date is a fact about the calendar, not a new read.
 */
export function recordSchedule(ticker: string, schedule: ScheduledCall, log: Log) {
  const manifest = readManifest(ticker);
  const current = readSheet(ticker);
  if (!manifest || !current) return;
  if (manifest.schedule?.date === schedule.date) return;
  writeManifest(ticker, { ...manifest, schedule });
  const sheet = rebuild(ticker);
  if (sheet.version === current.version) writeSheet(sheet);
  log(`${ticker}: next call set to ${schedule.date} from a monitor event`);
}

/**
 * Fallback for a call the monitor never reported as held: once the sheet's
 * next-call date is a day old with no call-day record, run the pipeline on the
 * date alone. A call that slipped finds no transcript and waits, or the update
 * run finds no statements from that date and the gate holds it.
 */
export async function catchUpCalls(client: Parallel, options: { webhookUrl: string | null; wait: boolean; log: Log; today?: string }) {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  for (const company of readCoverageConfig().companies) {
    const sheet = readSheet(company.ticker);
    const due = sheet?.nextCall.date;
    if (!sheet || !due || due <= sheet.latestCall.date) continue;
    const daysPast = (new Date(`${today}T12:00:00Z`).getTime() - new Date(`${due}T12:00:00Z`).getTime()) / 86_400_000;
    if (daysPast < 1 || daysPast > 14 || readCallDay(company.ticker, due)) continue;
    options.log(`${company.ticker}: no "held" event for the ${due} call; running on the scheduled date`);
    await startCallDay(
      client,
      company.ticker,
      { date: due, quarter: sheet.nextCall.quarter ?? "latest" },
      { kind: "schedule", monitorId: null, eventId: null, eventGroupId: null, eventDate: null, content: { call_date: due, source: sheet.nextCall.source ?? "task" }, citations: [] },
      options,
    );
  }
}

/** Retries Search for calls whose transcript was not online yet (up to four days). */
export async function retryWaiting(client: Parallel, options: { webhookUrl: string | null; wait: boolean; log: Log }) {
  const now = Date.now();
  for (const record of listCallDays().filter((r) => r.status === "waiting_transcript")) {
    if (now - new Date(`${record.callDate}T12:00:00Z`).getTime() > 4 * 86_400_000) continue;
    const url = typeof record.trigger.content?.source_url === "string" ? record.trigger.content.source_url : undefined;
    await startCallDay(client, record.ticker, { date: record.callDate, quarter: record.quarter, kind: record.kind ?? "call", url }, record.trigger, options);
  }
}
