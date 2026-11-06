/**
 * Make one tear sheet locally: the sheet run, then evidence, Extract fills,
 * Image Search, the gate and publishing, then stages 2 and 3 (a history and a
 * fact-check per promise). Waits on each run here instead of a webhook.
 *
 *   pnpm sheet MSFT                    new sheet run
 *   pnpm sheet MSFT --processor ultra  pick the processor
 *
 * The recipe is src/sheet/make-sheet.ts; what follows it is src/pipeline/advance.ts.
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { drive } from "../src/pipeline/drive";
import { startSheet } from "../src/sheet/make-sheet";
import { readMonitor, readSheet, withLock } from "../src/store";
import { flag, loadEnv, positional, today } from "./lib/env";

loadEnv();
const [arg] = positional();
if (!arg) {
  console.error("usage: pnpm sheet <TICKER> [--processor ultra2x] [--as-of YYYY-MM-DD]");
  process.exit(1);
}
const ticker = arg.toUpperCase();
const log = (line: string) => console.log(line);
try {
  const client = parallelClient();
  const started = await withLock(ticker, () => startSheet(client, ticker, { processor: flag("processor"), asOf: flag("as-of") ?? today(), log }));
  const driveError = await drive(client, [ticker], log).catch((error: unknown) => publicError(error));
  if (driveError) console.error(driveError);
  const sheet = await readSheet(ticker);
  if (!sheet || sheet.runs[0]?.runId !== started.run.run_id) throw new Error(`${ticker}: this run did not publish a sheet; see the run log and output/drafts`);
  const monitor = await readMonitor(ticker);
  const total = sheet.promises.length;
  const histories = sheet.runs.filter((r) => r.kind === "trail").length;
  const checks = sheet.promises.filter((p) => p.factCheck).length;
  log(`${ticker}: published v${sheet.version} with ${histories}/${total} histories and ${checks}/${total} fact-checks`);
  if (monitor) log(`${ticker}: monitor ${monitor.monitorId}${monitor.cancelledAt ? " (cancelled)" : ""}`);
  else console.error(`${ticker}: no monitor. Run pnpm monitors create ${ticker} to start one.`);
  if (driveError || histories !== total || checks !== total) {
    throw new Error(`${ticker}: follow the retry instructions above, or run pnpm deepen ${ticker} for pending work`);
  }
  if (!monitor) process.exitCode = 1;
} catch (error) {
  console.error(publicError(error));
  process.exitCode = 1;
}
