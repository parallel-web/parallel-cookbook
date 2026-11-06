/**
 * Call day: when a monitor reports a new earnings call, find the transcript
 * with Search, read it with Extract, match excerpts to the tracked promises,
 * and compare them with what the update Task run returns for the same call.
 */
import type { Parallel } from "../parallel/client";

import { STANCE_KEY } from "../lib/marks";
import type { CallDayPassage, CallDayRecord, CallDayResult, Company, SheetData } from "../lib/types";
import { companyDomains, isTranscriptHost, sameCall, tierOf } from "../sheet/evidence";
import { callDayExtractRequest, callDaySearchRequest } from "./spec";
import { domainOf, keywords, keywordSet, markFigures, sentences, shared, stripMarkdown, substantiveFigures } from "../lib/text";

export const PICK_RULE =
  "Company page with “transcript” or “remarks” in the title, then transcript sites in rank order; the first that Extract returns in full is used";

/** A full call transcript runs 40,000+ characters; a paywall teaser or event page is far shorter. */
export const MIN_TRANSCRIPT_CHARS = 15_000;
const MAX_EXTRACT_TRIES = 3;

export interface SearchResponseLike {
  search_id: string;
  results: { url: string; title?: string | null; publish_date?: string | null; excerpts?: string[] | null }[];
}

export interface ExtractResponseLike {
  extract_id: string;
  results: { url: string; title?: string | null; excerpts?: string[] | null; full_content?: string | null }[];
}

const TX_TITLE = /transcript|prepared remarks|remarks|earnings call/i;

/** Search results as shown on the call-day page; `pickedUrl` is the page Extract actually used. */
export function rankResults(response: SearchResponseLike, ownDomains: string[], pickedUrl: string | null): CallDayResult[] {
  return (response.results ?? []).map((r, i) => ({
    rank: i + 1,
    title: r.title ?? domainOf(r.url),
    url: r.url,
    domain: domainOf(r.url),
    date: r.publish_date ?? null,
    own: tierOf(r.url, ownDomains) === "primary",
    transcript: /transcript|remarks/i.test(r.title ?? "") || isTranscriptHost(r.url),
    picked: r.url === pickedUrl,
  }));
}

/** Transcript candidates in pick-rule order, then the URL the monitor event named. */
export function candidateUrls(rows: CallDayResult[], monitorUrl: string | null): string[] {
  const urls = [
    ...rows.filter((r) => r.own && /transcript|remarks/i.test(r.title)),
    ...rows.filter((r) => isTranscriptHost(r.url) && TX_TITLE.test(r.title)),
  ].map((r) => r.url);
  if (monitorUrl) urls.push(monitorUrl);
  return [...new Set(urls)];
}

/**
 * Authored list, disclosed in README: verbs and filler that appear in many
 * promise labels ("Launch…", "Deliver…") and so cannot identify one by themselves.
 */
const GENERIC_LABEL_WORDS = new Set(
  (
    "launch deliver reach cut bring complete close achieve generate return expand accelerate reduce raise double make " +
    "limit match take restore open produce protect initiate exit separate ease scale keep hit meet grow improve target " +
    "online program plan goal annual monthly share shares model"
  )
    .split(" ")
    .flatMap((w) => keywords(w)),
);

const isWord = (w: string) => !/^\d+$/.test(w) && w.length >= 3;

function promiseKeys(sheet: SheetData, pid: string) {
  const p = sheet.promises.find((x) => x.id === pid);
  const latest = sheet.statements.filter((s) => s.promiseId === pid && s.stance !== "not_mentioned").slice(-1)[0];
  const all = new Set([...keywordSet(`${p?.label ?? ""} ${p?.commitment ?? ""} ${latest?.summary ?? ""}`)].filter(isWord));
  const label = new Set([...keywordSet(p?.label ?? "")].filter((w) => isWord(w) && !GENERIC_LABEL_WORDS.has(w)));
  return { all, label };
}

/**
 * Rule: a passage joins a promise when it shares at least two words (not bare
 * numbers) with the promise's label, commitment and latest statement, and at
 * least one of them is a distinctive word from the label; the strongest overlap
 * wins. Passages are one- or two-sentence windows from the Extract excerpts:
 * up to `perPromise` per promise, plus up to two unmatched passages that carry
 * figures, so the call record also shows what the register does not track.
 */
export function matchPassages(sheet: SheetData, texts: string[], perPromise = 2): CallDayPassage[] {
  const keys = new Map(sheet.promises.map((p) => [p.id, promiseKeys(sheet, p.id)]));
  type Cand = { text: string; ids: string[]; pid: string | null; hits: string[]; score: number; figures: number };
  const cands: Cand[] = [];
  texts.forEach((body, t) => {
    const ss = sentences(body);
    for (let i = 0; i < ss.length; i += 1) {
      for (const span of [1, 2]) {
        if (i + span > ss.length) continue;
        const text = ss.slice(i, i + span).join(" ");
        const words = text.split(/\s+/).length;
        if (words < 8 || words > 90) continue;
        const wKeys = keywordSet(text);
        let pid: string | null = null;
        let hits: string[] = [];
        let best = 0;
        for (const [id, k] of keys) {
          const h = shared(k.all, wKeys);
          const labelHits = h.filter((w) => k.label.has(w)).length;
          // Label words count double, so a passage goes to the promise it names.
          const strength = h.length + labelHits;
          if (h.length >= 2 && labelHits >= 1 && strength > best) {
            best = strength;
            hits = h;
            pid = id;
          }
        }
        const figures = substantiveFigures(text).size;
        cands.push({
          text: stripMarkdown(text),
          ids: Array.from({ length: span }, (_, j) => `${t}:${i + j}`),
          pid: hits.length >= 2 ? pid : null,
          hits: hits.length >= 2 ? hits : [],
          score: best * 10 + Math.min(figures, 3) - words / 100,
          figures,
        });
      }
    }
  });
  const used = new Set<string>();
  const seenText = new Set<string>();
  const picked: Cand[] = [];
  const take = (c: Cand) => {
    if (c.ids.some((id) => used.has(id)) || seenText.has(c.text)) return false;
    c.ids.forEach((id) => used.add(id));
    seenText.add(c.text);
    picked.push(c);
    return true;
  };
  for (const p of sheet.promises) {
    let n = 0;
    for (const c of cands.filter((x) => x.pid === p.id).sort((a, b) => b.score - a.score)) {
      if (n >= perPromise) break;
      if (take(c)) n += 1;
    }
  }
  let extra = 0;
  for (const c of cands.filter((x) => x.pid === null && x.figures > 0).sort((a, b) => b.figures - a.figures || b.score - a.score)) {
    if (extra >= 2) break;
    if (take(c)) extra += 1;
  }
  return picked.map((c) => ({ text: c.text, segs: markFigures(c.text), promiseId: c.pid, hits: c.hits, task: null, agree: "none", shared: [] }));
}

/** Figure agreement between a call-day excerpt and the Task's statement for the same promise and call. */
export function agreement(passage: string, task: string): { agree: CallDayPassage["agree"]; shared: string[] } {
  const a = substantiveFigures(passage);
  const b = substantiveFigures(task);
  const both = [...a].filter((x) => b.has(x));
  if (a.size === 0 || b.size === 0) return { agree: "none", shared: both };
  if (both.length === a.size && both.length === b.size) return { agree: "same", shared: both };
  if (both.length > 0) return { agree: "part", shared: both };
  return { agree: "diff", shared: [] };
}

/** Compares each matched excerpt with the statement for the same promise and call: from the update run, or any run when null. */
export function compareWithTask(record: CallDayRecord, sheet: SheetData, updateRunId: string | null): CallDayRecord {
  const near = (d: string) => Math.abs(new Date(`${d}T12:00:00Z`).getTime() - new Date(`${record.callDate}T12:00:00Z`).getTime()) <= 2 * 86_400_000;
  const passages = record.passages.map((p) => {
    if (!p.promiseId) return { ...p, task: null, agree: "none" as const, shared: [] };
    const st = sheet.statements.find((s) => s.promiseId === p.promiseId && (updateRunId === null || s.runId === updateRunId) && near(s.date));
    if (!st || st.stance === "not_mentioned") return { ...p, task: null, agree: "none" as const, shared: [] };
    const taskText = st.summary;
    const { agree, shared: both } = agreement(p.text, taskText);
    return {
      ...p,
      task: {
        statementId: st.id,
        stance: st.stance,
        k: STANCE_KEY[st.stance],
        segs: markFigures(st.summary),
        verbatim: false,
        domain: st.verbatim?.backing.domain ?? st.citations[0]?.domain ?? null,
      },
      agree,
      shared: both,
    };
  });
  return { ...record, passages };
}

export function coverageOf(sheet: SheetData, passages: CallDayPassage[]) {
  return sheet.promises.map((p) => ({ promiseId: p.id, n: passages.filter((x) => x.promiseId === p.id).length }));
}

/** Search + Extract for one call. Returns the record; the update Task run is started by the caller. */
export async function readCall(
  client: Parallel,
  company: Company,
  sheet: SheetData,
  record: CallDayRecord,
  sessionId: string,
  onRaw: (kind: "search" | "extract", id: string, payload: unknown) => Promise<void>,
): Promise<CallDayRecord> {
  const ownDomains = companyDomains(company.website, sheet.irUrl);
  const searchRequest = { ...callDaySearchRequest(company, { date: record.callDate, quarter: record.quarter }), session_id: sessionId };
  const searchResponse = (await client.search(searchRequest as never)) as unknown as SearchResponseLike;
  await onRaw("search", searchResponse.search_id, { request: searchRequest, response: searchResponse });
  const monitorUrl = typeof record.trigger.content?.transcript_url === "string" ? (record.trigger.content.transcript_url as string) : null;
  const candidates = candidateUrls(rankResults(searchResponse, ownDomains, null).filter(r => sameCall(record.quarter, r, record.callDate)), monitorUrl && sameCall(record.quarter, { url: monitorUrl, title: null }, record.callDate) ? monitorUrl : null).slice(0, MAX_EXTRACT_TRIES);
  if (candidates.length === 0) {
    return { ...record, search: { id: searchResponse.search_id, request: searchRequest, results: rankResults(searchResponse, ownDomains, null), pickRule: PICK_RULE }, status: "waiting_transcript" };
  }

  // A teaser or failed extraction cannot verify a call. Wait for a full candidate.
  let best: { url: string; id: string; request: Record<string, unknown>; texts: string[] } | null = null;
  for (const url of candidates) {
    const extractRequest = { ...callDayExtractRequest(sheet, url, record.callDate), session_id: sessionId };
    const extractResponse = (await client.extract(extractRequest as never)) as unknown as ExtractResponseLike;
    await onRaw("extract", extractResponse.extract_id, { request: extractRequest, response: extractResponse });
    const matching = extractResponse.results.filter(r => sameCall(record.quarter, { title: r.title ?? null, url: r.url }, record.callDate));
    const chars = matching.reduce((n, r) => n + (r.full_content?.length ?? 0), 0);
    // Match against the full transcript when Extract returned it, else against the excerpts.
    const texts = matching.flatMap((r) => (r.full_content ? [r.full_content] : (r.excerpts ?? [])));
    if (chars < MIN_TRANSCRIPT_CHARS) continue;
    best = { url, id: extractResponse.extract_id, request: extractRequest, texts };
    break;
  }
  if (!best) return { ...record, search: { id: searchResponse.search_id, request: searchRequest, results: rankResults(searchResponse, ownDomains, null), pickRule: PICK_RULE }, status: "waiting_transcript" };
  const used = best;
  const passages = matchPassages(sheet, used.texts);
  return {
    ...record,
    search: { id: searchResponse.search_id, request: searchRequest, results: rankResults(searchResponse, ownDomains, used.url), pickRule: PICK_RULE },
    extract: { id: used.id, request: used.request, url: used.url },
    passages,
    coverage: coverageOf(sheet, passages),
    status: "extracted",
  };
}

/** Extract only, for an announcement the monitor cited: read the page and match its passages to the promises. */
export async function readSource(
  client: Parallel,
  sheet: SheetData,
  record: CallDayRecord,
  url: string,
  sessionId: string,
  onRaw: (kind: "search" | "extract", id: string, payload: unknown) => Promise<void>,
): Promise<CallDayRecord> {
  const request = { ...callDayExtractRequest(sheet, url, record.callDate, "event"), session_id: sessionId };
  const response = (await client.extract(request as never)) as unknown as ExtractResponseLike;
  await onRaw("extract", response.extract_id, { request, response });
  const texts = response.results.flatMap((r) => (r.full_content ? [r.full_content] : (r.excerpts ?? [])));
  if (!texts.some(t => t.trim())) return { ...record, extract: { id: response.extract_id, request, url }, status: "waiting_transcript" };
  const passages = matchPassages(sheet, texts);
  return { ...record, extract: { id: response.extract_id, request, url }, passages, coverage: coverageOf(sheet, passages), status: "extracted" };
}
