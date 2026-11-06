/**
 * Fills statements the Task could not back with verbatim text.
 *
 * For each gap, in order, stopping at the first passage found:
 *  1. Extract the pages the Task cited for that statement, aimed at the
 *     statement with an objective and search queries;
 *  2. Search for the call's transcript; a Search excerpt that already carries
 *     the passage needs no Extract;
 *  3. Extract the picked Search result (company page first, then a transcript host).
 * Calls are capped per sheet.
 */
import type { Parallel } from "../parallel/client";

import type { Backing, Company, SheetData, Statement, Verbatim } from "../lib/types";
import { companyDomains, findPassage, isTranscriptHost, tierOf, toVerbatim, type MatchTarget } from "./evidence";
import { domainOf } from "../lib/text";

export interface SearchStep {
  kind: "search";
  request: Record<string, unknown>;
  response: {
    search_id: string;
    results: { url: string; title?: string | null; publish_date?: string | null; excerpts?: string[] | null }[];
  };
  pickedRank: number | null;
}

export interface ExtractStep {
  kind: "extract";
  request: Record<string, unknown>;
  response: { extract_id: string; results: { url: string; title?: string | null; excerpts?: string[] | null; full_content?: string | null }[] };
  urlFrom: "task-citation" | "search";
}

export interface FillRecord {
  statementId: string;
  runId: string;
  createdAt: string;
  steps: (SearchStep | ExtractStep)[];
}

export interface FillBudget {
  maxExtracts: number;
  maxSearches: number;
}

export const DEFAULT_FILL_BUDGET: FillBudget = { maxExtracts: 24, maxSearches: 12 };

/** Gaps worth filling: a statement that is not "not mentioned" and has no verbatim passage yet. */
export function gapsOf(sheet: SheetData, runId?: string): Statement[] {
  return sheet.statements.filter((s) => !s.verbatim && s.stance !== "not_mentioned" && (!runId || s.runId === runId));
}

/** Pick rule for a Search result used as an Extract target: company page first, then a transcript host. */
export function pickSearchResult(results: { url: string; title?: string | null }[], ownDomains: string[]): number {
  const own = results.findIndex((r) => tierOf(r.url, ownDomains) === "primary");
  if (own >= 0) return own;
  const tx = results.findIndex((r) => isTranscriptHost(r.url) || /transcript/i.test(r.title ?? ""));
  return tx >= 0 ? tx : results.length ? 0 : -1;
}

function searchMeta(step: SearchStep, rank: number): NonNullable<Backing["search"]> {
  return {
    id: step.response.search_id,
    rank,
    query: (step.request.search_queries as string[] | undefined)?.[0] ?? "",
    objective: String(step.request.objective ?? ""),
  };
}

/** Replays a fill record: the first step whose excerpts carry the statement wins. */
export function verbatimFromFill(fill: FillRecord, target: MatchTarget, ownDomains: string[]): Verbatim | null {
  let lastSearch: SearchStep | null = null;
  for (const step of fill.steps) {
    const results = step.response.results ?? [];
    let found = findPassage(
      target,
      results.map((r) => ({ url: r.url, title: r.title ?? null, excerpts: r.excerpts ?? [] })),
      ownDomains,
    );
    if (!found && step.kind === "extract") {
      // Full page text: exact quote only, since a whole transcript has many near matches.
      found = findPassage(
        target,
        step.response.results.flatMap((r) => (r.full_content ? [{ url: r.url, title: r.title ?? null, excerpts: [r.full_content] }] : [])),
        ownDomains,
        true,
      );
    }
    if (step.kind === "search") {
      lastSearch = step;
      if (found) {
        const rank = results.findIndex((r) => r.url === found.citation.url) + 1;
        return toVerbatim(found, { via: "search", search: searchMeta(step, rank) }, ownDomains);
      }
      continue;
    }
    if (found) {
      return toVerbatim(
        found,
        {
          via: "extract",
          urlFrom: step.urlFrom,
          extract: { id: step.response.extract_id, objective: String(step.request.objective ?? "") },
          ...(step.urlFrom === "search" && lastSearch ? { search: searchMeta(lastSearch, lastSearch.pickedRank ?? 0) } : {}),
        },
        ownDomains,
      );
    }
  }
  return null;
}

export async function fillGaps(
  client: Parallel,
  company: Company,
  sheet: SheetData,
  existing: FillRecord[],
  options: { runId?: string; budget?: FillBudget; sessionId: string; log?: (line: string) => void; concurrency?: number },
): Promise<FillRecord[]> {
  const budget = options.budget ?? DEFAULT_FILL_BUDGET;
  const ownDomains = companyDomains(company.website, sheet.irUrl);
  const log = options.log ?? (() => {});
  const done = new Set(existing.map((f) => `${f.runId}:${f.statementId}`));
  // Calls are reserved before they are made, so statements filled in parallel share one budget.
  let extracts = 0;
  let searches = 0;
  const takeExtract = () => (extracts < budget.maxExtracts ? ((extracts += 1), true) : false);
  const takeSearch = () => (searches < budget.maxSearches ? ((searches += 1), true) : false);

  const extract = async (s: Statement, label: string, urls: string[], urlFrom: ExtractStep["urlFrom"]): Promise<ExtractStep | null> => {
    const request = { ...fillExtractRequest(sheet, s, label, urls), session_id: options.sessionId };
    try {
      const response = (await client.extract(request as never)) as unknown as ExtractStep["response"];
      return { kind: "extract", request, response, urlFrom };
    } catch (error) {
      log(`  extract failed for ${s.id}: ${(error as Error).message}`);
      return null;
    }
  };

  const fillOne = async (s: Statement): Promise<FillRecord | null> => {
    const promise = sheet.promises.find((p) => p.id === s.promiseId);
    if (!promise || !s.runId) return null;
    const target: MatchTarget = { quote: s.quote, summary: s.summary, topic: `${promise.label} ${promise.commitment}` };
    const record: FillRecord = { statementId: s.id, runId: s.runId, createdAt: new Date().toISOString(), steps: [] };
    const hit = () => verbatimFromFill(record, target, ownDomains) !== null;

    const cited = s.citations.map((c) => c.url).filter((u) => !/\.(mp3|mp4|m4a)(\?|$)/i.test(u));
    if (cited.length && takeExtract()) {
      const step = await extract(s, promise.label, cited, "task-citation");
      if (step) record.steps.push(step);
      log(`  extract ${step?.response.extract_id ?? "-"} ${s.id} (${cited.slice(0, 3).map(domainOf).join(", ")}): ${hit() ? "found" : "no match"}`);
    }
    if (!hit() && takeSearch()) {
      const request = { ...fillSearchRequest(company, s, promise.label), session_id: options.sessionId };
      const response = (await client.search(request as never)) as unknown as SearchStep["response"];
      const picked = pickSearchResult(response.results ?? [], ownDomains);
      record.steps.push({ kind: "search", request, response, pickedRank: picked >= 0 ? picked + 1 : null });
      log(`  search ${response.search_id} ${s.id}: ${response.results?.length ?? 0} results, pick ${picked + 1}: ${hit() ? "found in excerpt" : "no match"}`);
      const pickedUrl = picked >= 0 ? response.results[picked].url : null;
      if (!hit() && pickedUrl && !cited.slice(0, 3).includes(pickedUrl) && takeExtract()) {
        const step = await extract(s, promise.label, [pickedUrl], "search");
        if (step) record.steps.push(step);
        log(`  extract ${step?.response.extract_id ?? "-"} ${s.id} (${domainOf(pickedUrl)}): ${hit() ? "found" : "no match"}`);
      }
    }
    return record.steps.length ? record : null;
  };

  // Fill records are keyed to the run that made the statement, so a statement without one is skipped.
  const queue = gapsOf(sheet, options.runId).filter((s) => s.runId && !done.has(`${s.runId}:${s.id}`));
  const records: FillRecord[] = [];
  await Promise.all(
    Array.from({ length: options.concurrency ?? 4 }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        if (extracts >= budget.maxExtracts && searches >= budget.maxSearches) return;
        const record = await fillOne(s);
        if (record) records.push(record);
      }
    }),
  );
  // Keep the sheet's statement order, so a rebuild picks fills deterministically.
  const order = new Map(sheet.statements.map((s, i) => [s.id, i]));
  return records.sort((a, b) => (order.get(a.statementId) ?? 0) - (order.get(b.statementId) ?? 0));
}

/** Extract request that fills a statement whose Task citations held no verbatim text. */
export function fillExtractRequest(
  sheet: Pick<SheetData, "short">,
  statement: { date: string; call: string; summary: string; quote: string | null },
  promiseLabel: string,
  urls: string[],
) {
  const queries = [promiseLabel, ...(statement.quote ? [firstWords(statement.quote, 12)] : [])];
  return {
    urls: urls.slice(0, 2),
    objective:
      `What ${sheet.short} executives said on the ${statement.call} (${statement.date}) about ${promiseLabel}: ` +
      statement.summary,
    search_queries: queries.map((q) => q.slice(0, 200)),
    // Excerpts aim at the statement; full content lets the exact sentence be found
    // when a cited excerpt was cut off mid-sentence (common in transcript PDFs).
    advanced_settings: { excerpt_settings: { max_chars_per_result: 4000 }, full_content: { max_chars_per_result: 150000 } },
  };
}

/** Search request that finds a source when a statement has no usable citation. */
export function fillSearchRequest(
  company: Company,
  statement: { date: string; call: string; summary: string },
  promiseLabel: string,
) {
  return {
    objective:
      `Find ${company.name}'s ${statement.call} (${statement.date}) transcript passage about ${promiseLabel}: ` +
      statement.summary,
    search_queries: [
      `${company.short} ${statement.call} transcript ${promiseLabel}`.slice(0, 200),
      `${company.short} ${statement.date.slice(0, 4)} ${promiseLabel}`.slice(0, 200),
    ],
    mode: "advanced" as const,
  };
}

function firstWords(text: string, n: number) {
  return text.split(/\s+/).slice(0, n).join(" ");
}

