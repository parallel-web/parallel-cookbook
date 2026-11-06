/**
 * Stages 2 and 3 for published sheets, wherever they are due: a history run
 * (trail@1) for each promise without one, an independent fact-check (check@2)
 * for each outcome without a current one, two more checks for a disputed
 * outcome, and a resolution run (resolve@1) when most checks dispute it. Then
 * the gate, and a new version if anything changed.
 *
 *   pnpm deepen              every company
 *   pnpm deepen MSFT GM      some companies
 *
 * The rules are src/pipeline/advance.ts; the deployment applies them after every run.
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { advance } from "../src/pipeline/advance";
import { drive } from "../src/pipeline/drive";
import { eachLimit } from "../src/pipeline/reconcile";
import { readManifest } from "../src/sheet/stored";
import { readCoverageConfig, withLock } from "../src/store";
import { loadEnv, positional } from "./lib/env";

loadEnv();
const picked = positional().map((t) => t.toUpperCase());
const tickers = picked.length ? picked : readCoverageConfig().companies.map((c) => c.ticker);
const log = (line: string) => console.log(line);
try {
  const client = parallelClient();
  await eachLimit(tickers, 4, async (t) => {
    if (await readManifest(t)) await withLock(t, () => advance(client, t, log));
  });
  await drive(client, tickers, log);
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
