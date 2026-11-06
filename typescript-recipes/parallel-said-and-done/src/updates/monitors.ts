/**
 * Monitor API: one event_stream monitor per company, and the poll that turns
 * their events into new sheet versions.
 *
 * `pollMonitors` is the live loop. Any scheduler can call it: cron, a CI job, or
 * `pnpm monitors poll` by hand.
 */
import type { Company } from "../lib/types";
import type { Parallel } from "../parallel/client";
import { publicError } from "../parallel/client";
import { qualityPass } from "../sheet/deepen";
import { makeCoverage } from "../sheet/make-sheet";
import { profileCompanies } from "../sheet/profile";
import { companyFor, listRaw, readCoverageConfig, readMonitors, readPending, readSheet, writeMonitors, type MonitorRecord } from "../store";
import { onMonitorEvent, type MonitorEvent } from "./monitor-events";
import { MONITOR_FREQUENCY, MONITOR_OUTPUT_SCHEMA, MONITOR_PROCESSOR, MONITOR_SPEC_KEY, monitorQuery } from "./spec";
import { catchUpCalls, retryWaiting } from "./update";

type Log = (line: string) => void;

const WEBHOOK_EVENTS = ["monitor.event.detected", "monitor.execution.completed", "monitor.execution.failed"] as const;

function monitorRequest(company: Company, webhookUrl: string | null) {
  return {
    type: "event_stream" as const,
    frequency: MONITOR_FREQUENCY,
    processor: MONITOR_PROCESSOR,
    settings: {
      query: monitorQuery(company, readSheet(company.ticker)),
      output_schema: { type: "json" as const, json_schema: MONITOR_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
      // The first execution returns a sample of recent events, so the wiring can be checked right away.
      include_backfill: true,
    },
    metadata: { app: "said-and-done", ticker: company.ticker, spec: MONITOR_SPEC_KEY },
    ...(webhookUrl ? { webhook: { url: webhookUrl, event_types: [...WEBHOOK_EVENTS] } } : {}),
  };
}

async function createOne(client: Parallel, ticker: string, webhookUrl: string | null): Promise<MonitorRecord> {
  const request = monitorRequest(companyFor(ticker), webhookUrl);
  const monitor = await client.monitor.create(request as never);
  return {
    ticker,
    monitorId: monitor.monitor_id,
    spec: MONITOR_SPEC_KEY,
    query: request.settings.query,
    frequency: MONITOR_FREQUENCY,
    processor: MONITOR_PROCESSOR,
    createdAt: new Date().toISOString(),
    handledEventIds: [],
  };
}

export async function createMonitors(client: Parallel, tickers: string[], webhookUrl: string | null, log: Log) {
  const records = readMonitors();
  for (const ticker of tickers) {
    const existing = records.find((r) => r.ticker === ticker);
    if (existing) {
      log(`${ticker}: already has ${existing.monitorId}`);
      continue;
    }
    const record = await createOne(client, ticker, webhookUrl);
    records.push(record);
    writeMonitors(records);
    log(`${ticker}: created ${record.monitorId}`);
  }
}

/**
 * Keeps each monitor's query in step with its sheet's register. A monitor on
 * an older spec (a different output schema) is replaced: the new one is
 * created first, then the old one is cancelled. A changed register only edits
 * the query in place.
 */
export async function syncMonitors(client: Parallel, options: { replace: boolean; webhookUrl?: string | null; log: Log }) {
  const records = readMonitors();
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    const company = companyFor(r.ticker);
    if (r.spec !== MONITOR_SPEC_KEY) {
      if (!options.replace) {
        options.log(`${r.ticker}: ${r.monitorId} is on ${r.spec}; run pnpm monitors sync to replace it`);
        continue;
      }
      const next = await createOne(client, r.ticker, options.webhookUrl ?? null);
      records[i] = next;
      writeMonitors(records);
      await client.monitor.cancel(r.monitorId);
      options.log(`${r.ticker}: ${r.spec} ${r.monitorId} → ${MONITOR_SPEC_KEY} ${next.monitorId}`);
      continue;
    }
    const query = monitorQuery(company, readSheet(r.ticker));
    if (query === r.query) continue;
    await client.monitor.update(r.monitorId, { type: "event_stream", settings: { query } } as never);
    records[i] = { ...r, query };
    writeMonitors(records);
    options.log(`${r.ticker}: monitor query now tracks ${readSheet(r.ticker)?.promises.length ?? 0} promises`);
  }
}

async function allEvents(client: Parallel, monitorId: string): Promise<MonitorEvent[]> {
  const out: MonitorEvent[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const res = await client.monitor.events(monitorId, { limit: 100, ...(cursor ? { cursor } : {}) });
    out.push(...res.events);
    cursor = (res as { next_cursor?: string | null }).next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}

/**
 * Coverage grows by adding a line to config/companies.json. The poll makes a
 * sheet for each company that has none (one Task Group for all of them) and
 * gives every published sheet a monitor. A company whose sheet was already
 * attempted and held is left for a person to look at.
 */
export async function ensureCoverage(client: Parallel, options: { log: Log; asOf?: string }) {
  const { log } = options;
  const pending = readPending().filter((p) => Date.now() - new Date(p.startedAt).getTime() < 4 * 3_600_000);
  const missing = coveredTickers().filter(
    (t) => !readSheet(t) && !pending.some((p) => p.ticker === t) && listRaw(t, "sheet-run").length === 0,
  );
  if (missing.length) {
    log(`coverage: making sheets for ${missing.join(" ")}`);
    await makeCoverage(client, missing, { asOf: options.asOf ?? new Date().toISOString().slice(0, 10), trigger: "initial", log });
  }
  await profileCompanies(client, readCoverageConfig().companies, log);
  const watched = new Set(readMonitors().map((r) => r.ticker));
  const unwatched = coveredTickers().filter((t) => readSheet(t) && !watched.has(t));
  if (unwatched.length) await createMonitors(client, unwatched, null, log);
}

/**
 * The live loop: add any new companies, read every monitor's new events and
 * handle each one, then retry calls still waiting for a transcript and catch
 * calls no monitor reported.
 */
export async function pollMonitors(client: Parallel, options: { tickers?: string[]; log: Log }) {
  const { log } = options;
  if (!options.tickers) await ensureCoverage(client, { log });
  const before = new Map(readCoverageConfig().companies.map((c) => [c.ticker, readSheet(c.ticker)?.version ?? 0]));
  const records = readMonitors();
  const tickers = options.tickers ?? records.map((r) => r.ticker);
  for (const record of records.filter((r) => tickers.includes(r.ticker))) {
    const events = (await allEvents(client, record.monitorId)).filter((e) => e.event_type === "event_stream");
    const fresh = events.filter((e) => !record.handledEventIds.includes((e as { event_id: string }).event_id));
    log(`${record.ticker}: ${events.length} events, ${fresh.length} new`);
    // Oldest first, so a backfilled older call is seen before a newer one.
    fresh.sort((a, b) => String((a as { event_date?: string }).event_date).localeCompare(String((b as { event_date?: string }).event_date)));
    for (const event of fresh) {
      try {
        await onMonitorEvent(client, record, event, { webhookUrl: null, wait: true, log });
        record.handledEventIds.push((event as { event_id: string }).event_id);
        writeMonitors(records);
      } catch (error) {
        log(`${record.ticker}: ${publicError(error)}`);
      }
    }
  }
  await retryWaiting(client, { webhookUrl: null, wait: true, log });
  await catchUpCalls(client, { webhookUrl: null, wait: true, log });
  // Every new version gets the quality stages before the next poll.
  const changed = [...before].filter(([t, v]) => (readSheet(t)?.version ?? 0) !== v).map(([t]) => t);
  if (changed.length) await qualityPass(client, changed, { asOf: new Date().toISOString().slice(0, 10), log });
  // A new version may have added promises: point the monitors' queries at the current registers.
  await syncMonitors(client, { replace: false, log });
}

export async function listMonitors(client: Parallel, log: Log) {
  for (const r of readMonitors()) {
    const m = await client.monitor.retrieve(r.monitorId);
    log(`${r.ticker.padEnd(5)} ${r.monitorId} ${m.status} every ${m.frequency} · last run ${(m as { last_run_at?: string }).last_run_at ?? "-"} · handled ${r.handledEventIds.length}`);
  }
}

export async function triggerMonitors(client: Parallel, tickers: string[], log: Log) {
  for (const r of readMonitors().filter((x) => tickers.includes(x.ticker))) {
    await client.monitor.trigger(r.monitorId);
    log(`${r.ticker}: triggered ${r.monitorId}`);
  }
}


/** Cancelling is irreversible; billing stops. */
export async function cancelMonitors(client: Parallel, tickers: string[], log: Log) {
  const keep: MonitorRecord[] = [];
  for (const r of readMonitors()) {
    if (!tickers.includes(r.ticker)) {
      keep.push(r);
      continue;
    }
    await client.monitor.cancel(r.monitorId);
    log(`${r.ticker}: cancelled ${r.monitorId}`);
  }
  writeMonitors(keep);
}

export function coveredTickers(): string[] {
  return readCoverageConfig().companies.map((c) => c.ticker);
}
