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
import { readSheet, withLock } from "../src/store";
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
  await withLock(ticker, () => startSheet(client, ticker, { processor: flag("processor"), asOf: flag("as-of") ?? today(), log }));
  await drive(client, [ticker], log);
  const sheet = await readSheet(ticker);
  console.log(sheet ? `${ticker}: published v${sheet.version}` : `${ticker}: not published; see output/drafts`);
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
