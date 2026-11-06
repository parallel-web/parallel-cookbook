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
 * Step 1 starts the run (`startSheet`); its result arrives by webhook, and
 * `completeSheet` does steps 2 to 5. Stages 2 and 3 (histories and
 * fact-checks) follow from src/pipeline/advance.ts.
 *
 * Raw responses are stored before anything is derived from them.
 */
import type { Company, PublishedEntry, SheetData } from "../lib/types";
import type { Parallel } from "../parallel/client";
import type { StoredRun } from "../parallel/task";
import { startRun } from "../pipeline/runs";
import { companyFor, readCoverageConfig, readSheet, writeDraft, writeRaw } from "../store";
import { fillGaps } from "./fill";
import { searchImages } from "./images";
import { SHEET_PROCESSOR, SHEET_SPEC_KEY, sheetRunRequest } from "./spec";
import { publish, rebuild, sessionId, writeManifest, type Manifest } from "./stored";

type Log = (line: string) => void;

/** Step 1: one Task run builds the register and every dated statement. Call with the company's lock held. */
export async function startSheet(client: Parallel, ticker: string, options: { processor?: string; asOf: string; log: Log }) {
  const company = companyFor(ticker);
  const { windowStart } = readCoverageConfig();
  const request = sheetRunRequest(company, windowStart, options.asOf, options.processor ?? SHEET_PROCESSOR);
  const stored = await startRun(client, ticker, "sheet-run", request, SHEET_SPEC_KEY);
  options.log(`${ticker}: sheet run ${stored.run.run_id} (${stored.run.processor})`);
  return stored;
}

/** Steps 2 to 5 for a finished sheet run: evidence, Extract fills, Image Search, gate, publish. */
export async function completeSheet(
  client: Parallel,
  company: Company,
  stored: StoredRun,
  options: { trigger: PublishedEntry["trigger"]; log: Log; images?: boolean },
): Promise<{ sheet: SheetData; published: boolean }> {
  const ticker = company.ticker;
  const runId = stored.run.run_id;
  await writeRaw(ticker, "sheet-run", runId, stored);
  if (stored.result?.run.status !== "completed") throw new Error(`Sheet run ${runId} ended ${stored.result?.run.status}`);
  const current = await readSheet(ticker);
  const entry = { trigger: options.trigger, callDate: null, monitorEventId: null };
  if (current?.runs[0]?.runId === runId) {
    await publish(current, entry);
    return { sheet: current, published: true };
  }
  const manifest: Manifest = { sheetRunId: runId, taskGroupId: null, updates: [], images: false, baseVersion: current?.version ?? 0 };
  // A sheet run starts with an empty fill log, so every gap is filled from scratch.
  await writeRaw(ticker, "fills", runId, []);

  // 2. Evidence: rebuild keeps a quote only where the run's own citations contain it.
  let sheet = await rebuild(ticker, { manifest });
  options.log(`${ticker}: ${sheet.statements.length} statements, ${sheet.statements.filter((s) => s.verbatim).length} backed by Task citations`);

  // 3. Extract API (Search API when nothing was cited) for the statements still without verbatim text.
  const fills = await fillGaps(client, company, sheet, [], { sessionId: sessionId(ticker, runId), log: options.log });
  await writeRaw(ticker, "fills", runId, fills);

  // 4. Image Search: logo and header photo.
  if (options.images !== false) {
    const images = await searchImages(client, company, sheet.photoSubject, sessionId(ticker, runId), sheet.irUrl);
    await writeRaw(ticker, "images", runId, images);
    manifest.images = true;
  }

  // 5. Build and gate: publish, or hold the draft in output/drafts.
  sheet = await rebuild(ticker, { manifest });
  options.log(`${ticker}: ${sheet.statements.filter((s) => s.verbatim).length} verbatim after fills; gate ${sheet.gate.passed ? "passed" : "failed"}`);
  for (const c of sheet.gate.checks) options.log(`  ${c.result.padEnd(4)} ${c.label}: ${c.detail}`);
  if (!sheet.gate.passed) {
    await writeDraft(sheet, `v${sheet.version}`);
    return { sheet, published: false };
  }
  await writeManifest(ticker, manifest);
  await publish(sheet, entry);
  return { sheet, published: true };
}
