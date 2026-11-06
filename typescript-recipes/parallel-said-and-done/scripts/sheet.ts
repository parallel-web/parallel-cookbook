/**
 * Make one tear sheet: one Task run → verbatim backing from its citations →
 * Extract fills → Image Search → quality gate → publish to data/.
 *
 *   pnpm sheet MSFT                    new sheet run
 *   pnpm sheet MSFT --processor ultra  pick the processor
 *   pnpm sheet MSFT --resume trun_…    finish a run that was already created
 *
 * The recipe is src/sheet/make-sheet.ts.
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { makeSheet } from "../src/sheet/make-sheet";
import { flag, loadEnv, positional, today } from "./lib/env";

loadEnv();
const [ticker] = positional();
if (!ticker) {
  console.error("usage: pnpm sheet <TICKER> [--processor ultra2x] [--resume <run_id>] [--as-of YYYY-MM-DD]");
  process.exit(1);
}
try {
  const { sheet, published } = await makeSheet(parallelClient(), ticker.toUpperCase(), {
    processor: flag("processor"),
    resumeRunId: flag("resume"),
    asOf: flag("as-of") ?? today(),
    log: (line) => console.log(line),
  });
  console.log(published ? `published data/sheets/${sheet.ticker}.json (v${sheet.version})` : `held: output/drafts/${sheet.ticker}-v${sheet.version}.json`);
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
