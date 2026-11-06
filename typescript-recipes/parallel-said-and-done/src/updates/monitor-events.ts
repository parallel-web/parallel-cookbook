/**
 * Monitor events → sheet updates. One event_stream monitor per company reports
 * earnings calls, and company announcements that move a tracked promise, as
 * structured events. Routing is deterministic on the monitor's own enum, its
 * dates and the source's host.
 */
import type { PaginatedMonitorEvents } from "parallel-web/resources/monitor";

import type { CallDayRecord, SheetData } from "../lib/types";
import type { Parallel } from "../parallel/client";
import { companyDomains, tierOf, toCitation } from "../sheet/evidence";
import { companyFor, readSheet, writeRaw, type MonitorRecord } from "../store";
import { recordSchedule, startCallDay } from "./update";

export type MonitorEvent = PaginatedMonitorEvents["events"][number];

type Log = (line: string) => void;

export interface MonitorCallEvent {
  event_kind: "earnings_call_held" | "earnings_call_scheduled" | "promise_update" | "other";
  call_date: string | null;
  fiscal_quarter: string | null;
  transcript_url: string | null;
  results_release_url: string | null;
  /** monitor@2: set on promise_update. */
  promise_id?: string | null;
  source_url?: string | null;
  source_title?: string | null;
  summary?: string;
}

export function parseMonitorEvent(event: MonitorEvent): MonitorCallEvent | null {
  if (event.event_type !== "event_stream") return null;
  const output = (event as { output?: { type?: string; content?: unknown } }).output;
  if (!output || output.type !== "json" || typeof output.content !== "object" || !output.content) return null;
  return output.content as MonitorCallEvent;
}

export type MonitorDecision =
  | { action: "ignore"; reason: string }
  | { action: "schedule"; callDate: string; quarter: string | null }
  | { action: "covered"; callDate: string; quarter: string }
  | { action: "update"; callDate: string; quarter: string }
  | { action: "event"; callDate: string; quarter: string; promiseId: string; url: string };

/** Deterministic routing on the monitor's own enum and dates. */
export function decide(sheet: SheetData | null, parsed: MonitorCallEvent | null, today = new Date().toISOString().slice(0, 10)): MonitorDecision {
  if (!parsed) return { action: "ignore", reason: "not a structured event" };
  if (parsed.event_kind === "promise_update") return decideAnnouncement(sheet, parsed, today);
  if (parsed.event_kind !== "earnings_call_held" && parsed.event_kind !== "earnings_call_scheduled") return { action: "ignore", reason: parsed.event_kind };
  if (!parsed.call_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.call_date)) return { action: "ignore", reason: "no call date" };
  if (!sheet) return { action: "ignore", reason: "no published sheet" };
  if (parsed.event_kind === "earnings_call_scheduled") {
    return parsed.call_date > sheet.latestCall.date
      ? { action: "schedule", callDate: parsed.call_date, quarter: parsed.fiscal_quarter }
      : { action: "ignore", reason: "scheduled call already covered" };
  }
  const quarter = parsed.fiscal_quarter ?? "latest";
  if (parsed.call_date <= sheet.latestCall.date) return { action: "covered", callDate: parsed.call_date, quarter };
  return { action: "update", callDate: parsed.call_date, quarter };
}

/**
 * An announcement between calls updates the sheet only when it is about a
 * tracked promise, comes from the company itself (its own site, SEC or a
 * newswire), and is newer than everything the sheet has read.
 */
function decideAnnouncement(sheet: SheetData | null, parsed: MonitorCallEvent, today: string): MonitorDecision {
  if (!sheet) return { action: "ignore", reason: "no published sheet" };
  const date = parsed.call_date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return { action: "ignore", reason: "no announcement date" };
  const promise = sheet.promises.find((p) => p.id === parsed.promise_id);
  if (!promise) return { action: "ignore", reason: `not a tracked promise (${parsed.promise_id ?? "none"})` };
  if (!parsed.source_url) return { action: "ignore", reason: "no source" };
  if (tierOf(parsed.source_url, companyDomains(sheet.website, sheet.irUrl)) !== "primary") return { action: "ignore", reason: "not a company source" };
  const lastRead = [sheet.latestCall.date, ...sheet.statements.filter((s) => s.promiseId === promise.id).map((s) => s.date)].sort().at(-1)!;
  if (date <= lastRead) return { action: "ignore", reason: "already covered" };
  return { action: "event", callDate: date, quarter: parsed.source_title?.trim() || "Company announcement", promiseId: promise.id, url: parsed.source_url };
}

/** Entry point for both the webhook route and the local poller. */
export async function onMonitorEvent(
  client: Parallel,
  monitor: MonitorRecord,
  event: MonitorEvent,
  options: { webhookUrl: string | null; wait: boolean; log: Log },
): Promise<CallDayRecord | null> {
  writeRaw(monitor.ticker, "monitor-event", (event as { event_id: string }).event_id, event);
  const parsed = parseMonitorEvent(event);
  const sheet = readSheet(monitor.ticker);
  const decision = decide(sheet, parsed);
  options.log(`${monitor.ticker}: monitor event ${(event as { event_id: string }).event_id} → ${decision.action}${"reason" in decision ? ` (${decision.reason})` : ` ${decision.callDate}`}`);
  if (decision.action === "ignore") return null;
  if (decision.action === "schedule") {
    recordSchedule(monitor.ticker, { date: decision.callDate, quarter: decision.quarter, eventId: (event as { event_id: string }).event_id }, options.log);
    return null;
  }
  const company = companyFor(monitor.ticker);
  const basis = ((event as { output?: { basis?: { citations?: { url: string; title?: string | null }[] }[] } }).output?.basis ?? []).flatMap(
    (b) => b.citations ?? [],
  );
  const own = companyDomains(company.website, sheet?.irUrl);
  const trigger: CallDayRecord["trigger"] = {
    kind: "monitor",
    monitorId: monitor.monitorId,
    eventId: (event as { event_id: string }).event_id,
    eventGroupId: (event as { event_group_id: string }).event_group_id,
    eventDate: (event as { event_date: string | null }).event_date,
    content: parsed as unknown as Record<string, unknown>,
    citations: basis
      .filter((c, i) => basis.findIndex((x) => x.url === c.url) === i)
      .map((c) => toCitation({ url: c.url, title: c.title ?? null }, own)),
  };
  if (decision.action === "event") {
    return startCallDay(client, monitor.ticker, { date: decision.callDate, quarter: decision.quarter, kind: "event", url: decision.url }, trigger, options);
  }
  return startCallDay(client, monitor.ticker, { date: decision.callDate, quarter: decision.quarter }, trigger, options);
}

