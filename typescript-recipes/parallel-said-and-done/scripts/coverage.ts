/**
 * Makes every sheet in config/companies.json with one Task Group (one run per
 * company, same spec), then fills, gates and publishes each.
 *
 *   pnpm coverage                      all companies
 *   pnpm coverage MSFT META            a subset
 *   pnpm coverage --rerun              mark the new versions as a rerun
 *   pnpm coverage --group tgrp_…       resume waiting on a group already created
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { makeCoverage } from "../src/sheet/make-sheet";
import { readCoverageConfig } from "../src/store";
import { flag, loadEnv, positional, today } from "./lib/env";

loadEnv();
const picked = positional().map((t) => t.toUpperCase());
const tickers = picked.length ? picked : readCoverageConfig().companies.map((c) => c.ticker);
try {
  const out = await makeCoverage(parallelClient(), tickers, {
    processor: flag("processor"),
    asOf: flag("as-of") ?? today(),
    trigger: flag("rerun") ? "rerun" : "initial",
    resumeGroupId: flag("group"),
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify(out, null, 2));
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
