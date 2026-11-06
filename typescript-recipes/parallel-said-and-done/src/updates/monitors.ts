/**
 * Monitor API: one event_stream monitor per company. Each reports to the
 * webhook (WEBHOOK_URL); `onMonitorWebhook` fetches the execution's events and
 * routes each one (updates/monitor-events.ts). The hourly reconcile reads the
 * same events, so one a webhook missed is still handled.
 */
import type { MonitorCreateParams } from "parallel-web/resources/monitor";
import type { Company } from "../lib/types";
import type { Parallel } from "../parallel/client";
import { readManifest } from "../sheet/stored";
import { webhookUrl } from "../pipeline/runs";
import { companyFor, readCoverageConfig, readMonitor, readMonitors, readSheet, withLock, writeMonitor, type MonitorRecord } from "../store";
import { onMonitorEvent, type MonitorEvent } from "./monitor-events";
import { MONITOR_FREQUENCY, MONITOR_OUTPUT_SCHEMA, MONITOR_PROCESSOR, MONITOR_SPEC_KEY, monitorQuery } from "./spec";

type Log = (line: string) => void;

const WEBHOOK_EVENTS = ["monitor.event.detected", "monitor.execution.completed", "monitor.execution.failed"] as const;

const monitorWebhook = (url: string | null) => (url ? { url, event_types: [...WEBHOOK_EVENTS] } : null);

export const notFound = (error: unknown) => (error as { status?: number }).status === 404;

async function monitorRequest(company: Company, url: string | null) {
  return {
    type: "event_stream" as const,
    frequency: MONITOR_FREQUENCY,
    processor: MONITOR_PROCESSOR,
    settings: {
      query: monitorQuery(company, await readSheet(company.ticker)),
      output_schema: { type: "json" as const, json_schema: MONITOR_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
      // The first execution returns a sample of recent events, so the wiring can be checked right away.
      include_backfill: true,
    },
    metadata: { app: "said-and-done", ticker: company.ticker, spec: MONITOR_SPEC_KEY },
    ...(url ? { webhook: monitorWebhook(url) } : {}),
  } satisfies MonitorCreateParams;
}

async function createOne(client: Parallel, ticker: string): Promise<MonitorRecord> {
  const url = webhookUrl();
  const request = await monitorRequest(companyFor(ticker), url);
  const monitor = await client.monitor.create(request, { maxRetries: 0 });
  const record: MonitorRecord = {
    ticker,
    monitorId: monitor.monitor_id,
    spec: MONITOR_SPEC_KEY,
    query: request.settings.query,
    frequency: MONITOR_FREQUENCY,
    processor: MONITOR_PROCESSOR,
    createdAt: new Date().toISOString(),
    webhookUrl: url,
    handledEventIds: [],
  };
  try {
    await writeMonitor(record);
  } catch (error) {
    await cancelIfPresent(client, record.monitorId);
    throw error;
  }
  return record;
}

/** Call with the company lock held, including the check for an existing monitor. */
export async function ensureMonitor(client: Parallel, ticker: string, log: Log) {
  if (await readMonitor(ticker)) return;
  if (!(await readManifest(ticker))) {
    log(`${ticker}: run pnpm sheet ${ticker} before creating a monitor`);
    return;
  }
  const record = await createOne(client, ticker);
  log(`${ticker}: monitor ${record.monitorId}`);
}

/**
 * A monitor this app's key cannot find (deleted, or created under another
 * Parallel account) is replaced by a new one, unless it was cancelled on purpose.
 */
export async function replaceMissing(client: Parallel, record: MonitorRecord, log: Log) {
  const current = await readMonitor(record.ticker);
  if (!current || current.cancelledAt || current.monitorId !== record.monitorId) return;
  const next = await createOne(client, record.ticker);
  log(`${record.ticker}: monitor ${record.monitorId} not found; replaced by ${next.monitorId}`);
  return next;
}

export async function createMonitors(client: Parallel, tickers: string[], log: Log) {
  for (const ticker of tickers) {
    await withLock(ticker, () => ensureMonitor(client, ticker, log));
  }
}

async function forActiveMonitors(tickers: string[] | undefined, fn: (record: MonitorRecord) => Promise<void>) {
  for (const { ticker } of await readMonitors()) {
    if (tickers && !tickers.includes(ticker)) continue;
    await withLock(ticker, async () => {
      const current = await readMonitor(ticker);
      if (current && !current.cancelledAt) await fn(current);
    });
  }
}

async function cancelIfPresent(client: Parallel, monitorId: string) {
  try {
    await client.monitor.cancel(monitorId);
  } catch (error) {
    if (!notFound(error)) throw error;
  }
}

/**
 * Keeps each monitor in step: its query names the sheet's current promises,
 * and it reports to the current WEBHOOK_URL. A monitor on an older spec (a
 * different output schema) is cancelled before creating its replacement.
 */
export async function syncMonitors(client: Parallel, options: { replace: boolean; tickers?: string[]; log: Log }) {
  const url = webhookUrl();
  await forActiveMonitors(options.tickers, async r => {
    if (r.spec !== MONITOR_SPEC_KEY) {
      if (!options.replace) {
        options.log(`${r.ticker}: ${r.monitorId} is on ${r.spec}; run pnpm monitors sync to replace it`);
        return;
      }
      await cancelIfPresent(client, r.monitorId);
      const next = await createOne(client, r.ticker);
      options.log(`${r.ticker}: ${r.spec} ${r.monitorId} → ${MONITOR_SPEC_KEY} ${next.monitorId}`);
      return;
    }
    const sheet = await readSheet(r.ticker);
    const query = monitorQuery(companyFor(r.ticker), sheet);
    const changes: Record<string, unknown> = {};
    if (query !== r.query) Object.assign(changes, { type: "event_stream", settings: { query } });
    if ((r.webhookUrl ?? null) !== url) changes.webhook = monitorWebhook(url);
    if (!Object.keys(changes).length) return;
    try {
      await client.monitor.update(r.monitorId, changes as never);
    } catch (error) {
      if (!notFound(error)) throw error;
      await replaceMissing(client, r, options.log);
      return;
    }
    await writeMonitor({ ...r, query, webhookUrl: url });
    options.log(`${r.ticker}: monitor ${"settings" in changes ? `tracks ${sheet?.promises.length ?? 0} promises` : ""}${"webhook" in changes ? ` reports to ${url ?? "no webhook"}` : ""}`);
  });
}

/** Handles a monitor's events not handled yet, oldest first. Takes the company's lock. */
export async function handleMonitorEvents(client: Parallel, ticker: string, events: MonitorEvent[], log: Log) {
  return withLock(ticker, async () => {
    const record = await readMonitor(ticker);
    if (!record || record.cancelledAt) return 0;
    const id = (e: MonitorEvent) => (e as { event_id: string }).event_id;
    const date = (e: MonitorEvent) => String((e as { event_date?: string }).event_date ?? "");
    const fresh = events
      .filter((e) => e.event_type === "event_stream" && !record.handledEventIds.includes(id(e)))
      // A backfilled older call is seen before a newer one.
      .sort((a, b) => date(a).localeCompare(date(b)));
    for (const event of fresh) {
      await onMonitorEvent(client, record, event, { log });
      record.handledEventIds.push(id(event));
      await writeMonitor(record);
    }
    return fresh.length;
  });
}

/**
 * A monitor webhook. The body is only a hint: the monitor must be one of ours,
 * and its events are fetched from the API by the execution's event group.
 */
export async function onMonitorWebhook(client: Parallel, monitorId: string, eventGroupId: string, hintTicker: string | null, log: Log) {
  const hinted = hintTicker ? await readMonitor(hintTicker) : null;
  const record = hinted?.monitorId === monitorId ? hinted : (await readMonitors()).find((r) => r.monitorId === monitorId);
  if (!record || record.cancelledAt) return "ignored";
  const { events } = await client.monitor.events(monitorId, { event_group_id: eventGroupId });
  const handled = await handleMonitorEvents(client, record.ticker, events, log);
  log(`${record.ticker}: monitor webhook, ${events.length} events, ${handled} new`);
  return "handled";
}

/** Recent events for one monitor, for the reconcile. */
export async function recentEvents(client: Parallel, monitorId: string): Promise<MonitorEvent[]> {
  const out: MonitorEvent[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res = await client.monitor.events(monitorId, { limit: 100, ...(cursor ? { cursor } : {}) });
    out.push(...res.events);
    cursor = (res as { next_cursor?: string | null }).next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}

export async function listMonitors(client: Parallel, log: Log) {
  for (const r of await readMonitors()) {
    if (r.cancelledAt) {
      log(`${r.ticker.padEnd(5)} ${r.monitorId} cancelled ${r.cancelledAt}`);
      continue;
    }
    const m = await client.monitor.retrieve(r.monitorId);
    log(`${r.ticker.padEnd(5)} ${r.monitorId} ${m.status} every ${m.frequency} · last run ${(m as { last_run_at?: string }).last_run_at ?? "-"} · handled ${r.handledEventIds.length} · webhook ${r.webhookUrl ?? "none"}`);
  }
}

export async function triggerMonitors(client: Parallel, tickers: string[], log: Log) {
  for (const r of (await readMonitors()).filter((x) => tickers.includes(x.ticker) && !x.cancelledAt)) {
    await client.monitor.trigger(r.monitorId);
    log(`${r.ticker}: triggered ${r.monitorId}`);
  }
}

/** Cancelling is irreversible; billing stops. The record stays, marked cancelled, so no reconcile recreates it. */
export async function cancelMonitors(client: Parallel, tickers: string[], log: Log) {
  await forActiveMonitors(tickers, async r => {
    await cancelIfPresent(client, r.monitorId);
    await writeMonitor({ ...r, cancelledAt: new Date().toISOString() });
    log(`${r.ticker}: cancelled ${r.monitorId}`);
  });
}

export function coveredTickers(): string[] {
  return readCoverageConfig().companies.map((c) => c.ticker);
}
