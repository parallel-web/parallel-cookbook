/**
 * Display rules shared by the pages. Pure functions from the sheet data to
 * what a view shows: outcome words, call status, the promise track, the tear
 * sheet's paper-trail pick, figures as stated.
 */
import { callStatus, fmtDate, trackPos } from "./dates";
import { stanceLabel } from "./marks";
import { markFigures } from "./text";
import type { OutcomeKey, Promise, Seg, SheetData, Statement } from "./types";

export const OUTCOME_KEYS: OutcomeKey[] = ["done", "part", "rev", "open", "miss", "drop"];
export const OUTCOME_WORD: Record<OutcomeKey, string> = {
  done: "delivered",
  part: "partly delivered",
  rev: "revised",
  open: "open",
  miss: "missed",
  drop: "dropped",
};

/** The outcome as the Task wrote it, as a word: "Exceeded", "Partly delivered". */
export function outcomeWord(p: Pick<Promise, "status">): string {
  const w = p.status.replace(/_/g, " ");
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function countsOf(promises: Pick<Promise, "k">[]): Record<OutcomeKey, number> {
  const out = { done: 0, part: 0, rev: 0, open: 0, miss: 0, drop: 0 };
  for (const p of promises) out[p.k] += 1;
  return out;
}

/** "2 delivered · 1 revised · 2 open" */
export function tally(counts: Record<OutcomeKey, number>): string {
  return OUTCOME_KEYS.filter((k) => counts[k]).map((k) => `${counts[k]} ${OUTCOME_WORD[k]}`).join(" · ");
}

export { stanceLabel };

/* Calls. */

export interface CallView {
  date: string;
  time: string | null;
  quarter: string;
  upcoming: boolean;
  days: number | null;
}

/** Days a reported call stays "this season" before the next announced call takes its place. */
const SEASON_DAYS = 30;

/** This season's call: one reported in the last 30 days, else the next announced call, else the latest. */
export function callOf(sheet: SheetData, today: string): CallView {
  const sinceLatest = -(callStatus(sheet.latestCall.date, today).days ?? -999);
  const recent = sinceLatest >= 0 && sinceLatest <= SEASON_DAYS;
  if (!recent && sheet.nextCall.date && sheet.nextCall.date >= today) {
    return { date: sheet.nextCall.date, time: sheet.nextCall.time, quarter: sheet.nextCall.quarter ?? "—", upcoming: true, days: callStatus(sheet.nextCall.date, today).days };
  }
  return { date: sheet.latestCall.date, time: null, quarter: sheet.latestCall.quarter, upcoming: false, days: callStatus(sheet.latestCall.date, today).days };
}

/** "Reported", "Today", "In 13 days". */
export function dueWord(days: number | null): string {
  if (days === null) return "Not announced";
  if (days < 0) return "Reported";
  if (days === 0) return "Today";
  return `In ${days} ${days === 1 ? "day" : "days"}`;
}

/** Pill style for a call: reported, today, within 8 days, later. */
export function dueClass(days: number | null): string {
  if (days === null || days < 0) return "status-done";
  if (days === 0) return "status-today";
  return days <= 8 ? "status-soon" : "status-later";
}

/* Statements. */

/** Figures auto-marked in the text the sheet shows: the verbatim passage, else the Task summary. */
export function segsOf(s: Statement): Seg[] {
  return s.verbatim ? s.verbatim.segs : markFigures(s.summary);
}

const VIA: Record<string, string> = { search: "found via Search API", extract: "read via Extract API" };

/** Source line under a quote: domain, which API filled it, and any flags. */
export function sourceLine(s: Statement): string {
  if (!s.verbatim) {
    if (s.stance === "not_mentioned") return "Task output · not mentioned on this call";
    return s.citations[0] ? `Task summary, not verbatim · cited ${s.citations[0].domain}` : "Task summary · no verbatim text found for this date";
  }
  const b = s.verbatim.backing;
  const via = VIA[b.via] ? ` · ${VIA[b.via]}` : "";
  const flag = b.tier === "press" ? " · secondary source" : b.tier === "transcript" ? " · transcript site" : "";
  return `${b.domain}${via}${flag}`;
}

export function stanceText(s: Statement): string {
  return stanceLabel(s.stance);
}

export function statementsOf(sheet: SheetData, pid: string): Statement[] {
  return sheet.statements.filter((s) => s.promiseId === pid);
}

/**
 * Tear sheet paper trail: all statements when there are four or fewer;
 * otherwise the first, then the latest three that changed the target, filled
 * with the most recent ones. The caption says which rule applied.
 */
export function trailPick(trail: Statement[]): { picks: Statement[]; rule: string } {
  const n = trail.length;
  if (n <= 4) return { picks: trail, rule: `All ${n} ${n === 1 ? "statement" : "statements"}` };
  const changes = trail.map((_, i) => i).filter((i) => i > 0 && trail[i].k === "c");
  const pick = [0, ...changes.slice(-3)];
  for (let j = n - 1; pick.length < 4 && j > 0; j -= 1) if (!pick.includes(j)) pick.push(j);
  pick.sort((a, b) => a - b);
  const nc = pick.filter((i) => i > 0 && trail[i].k === "c").length;
  const nf = pick.length - 1 - nc;
  const rule = `4 of ${n} statements · first${nc ? `, latest ${nc === 1 ? "change" : "changes"}` : ""}${nf ? " and most recent" : ""} · all in Paper trail`;
  return { picks: pick.map((i) => trail[i]), rule };
}

/* The promise track: a line from first to last statement, one dot per statement. */

/** `start` sets the left edge of the axis; the tear sheet uses the research window, cards the first statement. */
export function trackOf(sheet: SheetData, pid: string, start: string = sheet.windowStart) {
  const ss = statementsOf(sheet, pid);
  const pos = (iso: string) => trackPos(iso, start, sheet.asOf);
  const l = ss.length ? pos(ss[0].date) : 0;
  const r = ss.length ? pos(ss[ss.length - 1].date) : 0;
  return {
    line: { l, w: Math.max(0, r - l) },
    dots: ss.map((s) => ({ l: pos(s.date), k: s.k === "c" ? "c" : s.k === "x" ? "x" : "s" })),
  };
}

export function axisYears(sheet: SheetData): [string, string] {
  return [sheet.windowStart.slice(0, 4), sheet.asOf.slice(0, 4)];
}

/* Coverage. */

export function asOfLine(iso: string | null): string {
  return iso ? `Data as of ${fmtDate(iso)}` : "No data yet";
}
