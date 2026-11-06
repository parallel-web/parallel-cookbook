/**
 * Makes a sheet for each company in config/companies.json that has none (or
 * the companies named), one Task run each, then follows each through stages 2
 * and 3. The deployment does the same for new companies on its hourly reconcile.
 *
 *   pnpm coverage                      every company without a sheet
 *   pnpm coverage MSFT META            these companies, even if they have one
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { drive } from "../src/pipeline/drive";
import { eachLimit } from "../src/pipeline/reconcile";
import { startSheet } from "../src/sheet/make-sheet";
import { readCoverageConfig, readSheet, withLock } from "../src/store";
import { flag, loadEnv, positional, today } from "./lib/env";

loadEnv();
const picked = positional().map((t) => t.toUpperCase());
const all = readCoverageConfig().companies.map((c) => c.ticker);
const tickers = picked.length ? picked : (await Promise.all(all.map(async (t) => ((await readSheet(t)) ? null : t)))).filter((t): t is string => !!t);
const log = (line: string) => console.log(line);
try {
  const client = parallelClient();
  await eachLimit(tickers, 8, async (t) => {
    await withLock(t, () => startSheet(client, t, { processor: flag("processor"), asOf: flag("as-of") ?? today(), log }));
  });
  await drive(client, tickers, log);
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
