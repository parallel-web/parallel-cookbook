/**
 * Rebuilds sheets from stored responses in output/raw. No API calls.
 *
 *   pnpm rebuild                  every company with stored runs
 *   pnpm rebuild MSFT
 *   pnpm rebuild --compare MSFT   score every stored sheet run (processor comparison)
 */
import type { StoredRun } from "../src/parallel/task";
import { sameContent } from "../src/pipeline/advance";
import { buildSheet } from "../src/sheet/build";
import { readManifest, rebuild } from "../src/sheet/stored";
import { companyFor, listCallDays, listRaw, readCoverageConfig, readRaw, readSheet, writeCallDay, writeSheet } from "../src/store";
import { rebuildCallDay } from "../src/updates/update";
import { flag, loadEnv, positional } from "./lib/env";

loadEnv();

const compare = flag("compare");
if (compare && compare !== "true") {
  const ticker = compare.toUpperCase();
  const company = companyFor(ticker);
  const { windowStart } = readCoverageConfig();
  for (const id of await listRaw(ticker, "sheet-run")) {
    const stored = await readRaw<StoredRun>(ticker, "sheet-run", id);
    if (!stored?.result || stored.result.run.status !== "completed") {
      console.log(`${id}: ${stored?.result?.run.status ?? "no result"}`);
      continue;
    }
    const sheet = buildSheet({ company, windowStart, sheetRun: stored, updates: [], fills: [], images: null, version: 1, builtAt: new Date().toISOString() });
    const said = sheet.statements.filter((s) => s.stance !== "not_mentioned");
    const elementBasis = (stored.result.output.basis ?? []).filter((b) => /^statements\.\d+$/.test(b.field)).length;
    const primary = sheet.sources.filter((s) => s.tier === "primary").length;
    const exact = said.filter((s) => s.verbatim?.match === "exact").length;
    console.log(
      [
        `${stored.run.processor.padEnd(8)} ${id}`,
        `promises ${sheet.promises.length}`,
        `statements ${sheet.statements.length} (${said.length} said, element basis ${elementBasis})`,
        `verbatim from Task citations ${said.filter((s) => s.verbatim).length} (${exact} exact quote)`,
        `sources ${sheet.sources.length} (${primary} primary)`,
        `gate ${sheet.gate.checks.map((c) => `${c.id}:${c.result}`).join(" ")}`,
        `labels: ${sheet.promises.map((p) => `${p.id} ${p.label} [${p.status}]`).join("; ")}`,
      ].join("\n  "),
    );
  }
} else {
  const picked = positional().map((t) => t.toUpperCase());
  const tickers = picked.length ? picked : readCoverageConfig().companies.map((c) => c.ticker);
  for (const ticker of tickers) {
    if (!(await readManifest(ticker))) continue;
    const sheet = await rebuild(ticker);
    const current = await readSheet(ticker);
    // Unchanged sheets keep their file (and builtAt), so a rebuild only touches what a rule change moved.
    if (sheet.gate.passed && current && current.version === sheet.version && !sameContent(current, sheet)) await writeSheet(sheet);
    console.log(`${ticker}: v${sheet.version} ${sheet.statements.filter((s) => s.verbatim).length}/${sheet.statements.length} verbatim · gate ${sheet.gate.passed ? "pass" : "fail"}${current ? "" : " (not published)"}`);
  }
  for (const record of (await listCallDays()).filter((r) => tickers.includes(r.ticker))) {
    const next = await rebuildCallDay(record);
    await writeCallDay(next);
    console.log(`${record.ticker} ${record.callDate}: ${next.passages.filter((p) => p.promiseId).length} of ${next.passages.length} passages matched`);
  }
}
