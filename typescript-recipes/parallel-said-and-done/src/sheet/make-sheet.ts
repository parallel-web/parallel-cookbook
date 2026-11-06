/**
 * Make one tear sheet. This file is the whole recipe; each step is one module.
 *
 *   1. Task API      one run returns the promise register and every dated
 *                    statement, with citations per statement      sheet/spec.ts
 *   2. Evidence      a statement is shown in quotes only when its own citations
 *                    contain the sentence word for word              sheet/evidence.ts
 *   3. Extract API   for statements the citations could not back, read the
 *                    cited page in full; Search API finds a page when none
 *                    was cited                                       sheet/fill.ts
 *   4. Image Search  a logo and a photo for the header              sheet/images.ts
 *   5. Build + gate  assemble the sheet; publish only if no check fails
 *                                                                    sheet/build.ts, sheet/gate.ts
 *
 * Raw responses are written to output/raw before anything is derived from them.
 */
import type { Company, PublishedEntry, SheetData } from "../lib/types";
import type { Parallel } from "../parallel/client";
import { awaitGroup, awaitResult, createRun, groupResults, startGroup, type StoredRun, type TaskRunResult } from "../parallel/task";
import { companyFor, readCoverageConfig, readPending, readRaw, readSheet, writeDraft, writePending, writeRaw } from "../store";
import { fillGaps } from "./fill";
import { searchImages } from "./images";
import { SHEET_PROCESSOR, SHEET_SPEC_KEY, sheetRunRequest } from "./spec";
import { publish, readManifest, rebuild, recordCoverageBuild, sessionId, writeManifest } from "./stored";

type Log = (line: string) => void;

/* Sheet generation. */

/**
 * Makes one company's sheet: one Task run, then steps 2 to 5.
 *
 *   pnpm sheet MSFT
 */
export async function makeSheet(
  client: Parallel,
  ticker: string,
  options: { processor?: string; asOf: string; resumeRunId?: string; log: Log },
): Promise<{ sheet: SheetData; published: boolean }> {
  const company = companyFor(ticker);
  const { windowStart } = readCoverageConfig();

  // 1. Task API: one run builds the register and every dated statement.
  const request = sheetRunRequest(company, windowStart, options.asOf, options.processor ?? SHEET_PROCESSOR);
  let stored: StoredRun;
  if (options.resumeRunId) {
    stored = readRaw<StoredRun>(company.ticker, "sheet-run", options.resumeRunId) ?? {
      run: await client.taskRun.retrieve(options.resumeRunId),
      input: request.input,
      spec: SHEET_SPEC_KEY,
      result: null,
    };
  } else {
    stored = await createRun(client, request, SHEET_SPEC_KEY);
    writeRaw(company.ticker, "sheet-run", stored.run.run_id, stored);
    options.log(`${ticker}: created ${stored.run.run_id} (${stored.run.processor})`);
  }
  const result = await awaitResult(client, stored.run.run_id, (s) => options.log(`${ticker}: waiting ${s}s`));
  return completeSheet(client, company, { ...stored, run: result.run, result }, { trigger: "manual", log: options.log });
}

/** Steps 2 to 5 for a finished sheet run: evidence, Extract fills, Image Search, gate, publish. */
export async function completeSheet(
  client: Parallel,
  company: Company,
  stored: StoredRun,
  options: { taskGroupId?: string | null; trigger: PublishedEntry["trigger"]; log: Log; images?: boolean },
): Promise<{ sheet: SheetData; published: boolean }> {
  const ticker = company.ticker;
  const runId = stored.run.run_id;
  writeRaw(ticker, "sheet-run", runId, stored);
  if (stored.result?.run.status !== "completed") throw new Error(`Sheet run ${runId} ended ${stored.result?.run.status}`);
  const baseVersion = readSheet(ticker)?.version ?? 0;
  writeManifest(ticker, { sheetRunId: runId, taskGroupId: options.taskGroupId ?? null, updates: [], images: false, baseVersion });
  // A sheet run starts with an empty fill log, so every gap is filled from scratch.
  writeRaw(ticker, "fills", runId, []);

  // 2. Evidence: rebuild keeps a quote only where the run's own citations contain it.
  let sheet = rebuild(ticker);
  options.log(`${ticker}: ${sheet.statements.length} statements, ${sheet.statements.filter((s) => s.verbatim).length} backed by Task citations`);

  // 3. Extract API (Search API when nothing was cited) for the statements still without verbatim text.
  const fills = await fillGaps(client, company, sheet, [], { sessionId: sessionId(ticker, runId), log: options.log });
  writeRaw(ticker, "fills", runId, fills);

  // 4. Image Search: logo and header photo.
  if (options.images !== false) {
    const images = await searchImages(client, company, sheet.photoSubject, sessionId(ticker, runId));
    writeRaw(ticker, "images", "latest", images);
    writeManifest(ticker, { ...readManifest(ticker)!, images: true });
  }

  // 5. Build and gate: publish to data/, or hold the draft in output/drafts.
  sheet = rebuild(ticker);
  options.log(`${ticker}: ${sheet.statements.filter((s) => s.verbatim).length} verbatim after fills; gate ${sheet.gate.passed ? "passed" : "failed"}`);
  for (const c of sheet.gate.checks) options.log(`  ${c.result.padEnd(4)} ${c.label}: ${c.detail}`);
  if (!sheet.gate.passed) {
    writeDraft(sheet, `v${sheet.version}`);
    return { sheet, published: false };
  }
  publish(sheet, { trigger: options.trigger, callDate: null, monitorEventId: null });
  return { sheet, published: true };
}

/**
 * Every company in one Task Group: same spec, one run per company, then
 * steps 2 to 5 for each. Resumable with `--group` if the wait is interrupted.
 *
 *   pnpm coverage
 */
export async function makeCoverage(
  client: Parallel,
  tickers: string[],
  options: { processor?: string; asOf: string; log: Log; trigger?: PublishedEntry["trigger"]; resumeGroupId?: string; concurrency?: number },
) {
  const { windowStart } = readCoverageConfig();
  const companies = tickers.map(companyFor);
  const processor = options.processor ?? SHEET_PROCESSOR;
  const requests = companies.map((c) => sheetRunRequest(c, windowStart, options.asOf, processor));
  let groupId = options.resumeGroupId;
  if (!groupId) {
    const started = await startGroup(client, requests, { app: "said-and-done", spec: SHEET_SPEC_KEY });
    groupId = started.groupId;
    options.log(`group ${groupId}: ${started.runIds.length} of ${requests.length} runs accepted`);
    recordCoverageBuild(groupId, processor, new Date().toISOString());
  }
  const startedAt = new Date().toISOString();
  writePending([...readPending().filter((p) => !tickers.includes(p.ticker)), ...tickers.map((ticker) => ({ ticker, groupId: groupId!, startedAt }))]);
  await awaitGroup(client, groupId, options.log);
  const out: { ticker: string; published: boolean }[] = [];
  const events = await groupResults(client, groupId);
  // Steps 2 to 5 for each finished run, a few companies at a time.
  const finish = async (event: (typeof events)[number]) => {
    const ticker = String((event.run.metadata as Record<string, unknown> | null)?.ticker ?? "");
    const company = companies.find((c) => c.ticker === ticker);
    if (!company) return;
    const stored: StoredRun = {
      run: event.run,
      input: (event.input?.input as Record<string, unknown>) ?? requests.find((r) => r.metadata.ticker === ticker)!.input,
      spec: SHEET_SPEC_KEY,
      result: event.output ? ({ run: event.run, output: event.output } as TaskRunResult) : null,
    };
    try {
      const { published } = await completeSheet(client, company, stored, { taskGroupId: groupId, trigger: options.trigger ?? "initial", log: options.log });
      out.push({ ticker, published });
    } catch (error) {
      options.log(`${ticker}: ${(error as Error).message}`);
      out.push({ ticker, published: false });
    }
  };
  const queue = [...events];
  await Promise.all(Array.from({ length: options.concurrency ?? 4 }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) await finish(e);
  }));
  writePending(readPending().filter((p) => p.groupId !== groupId));
  return { taskGroupId: groupId, results: out };
}
