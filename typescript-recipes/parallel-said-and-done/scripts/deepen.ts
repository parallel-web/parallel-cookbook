/**
 * Stages 2 and 3 for published sheets: a history run (trail@1) and an
 * independent fact-check (check@1) per promise, then the gate.
 *
 *   pnpm deepen                              every company
 *   pnpm deepen MSFT GM                      some companies
 *   pnpm deepen --only GM:P1,TJX:P2 --dry    chosen promises; drafts only, nothing published
 *   pnpm deepen --force                      redo promises that already have a history and a check
 *   pnpm deepen --checks-only                re-run only the fact-checks, e.g. after a check spec change
 *   pnpm deepen --vote                       two more checks for each disputed outcome; the majority stands
 *   pnpm deepen --resolve                    settle each disputed outcome with a deeper run, then re-check it
 *   pnpm deepen --quality                    all of the above, only where needed (what the poll runs)
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { deepen, qualityPass, resolveDisputes } from "../src/sheet/deepen";
import { readCoverageConfig } from "../src/store";
import { flag, loadEnv, positional, today } from "./lib/env";

loadEnv();
const only = flag("only")?.split(",").map((s) => s.trim().toUpperCase());
const picked = positional().map((t) => t.toUpperCase());
const tickers = picked.length ? picked : only ? [...new Set(only.map((s) => s.split(":")[0]))] : readCoverageConfig().companies.map((c) => c.ticker);
try {
  if (flag("quality") === "true") {
    await qualityPass(parallelClient(), tickers, { asOf: flag("as-of") ?? today(), log: (l) => console.log(l) });
    process.exit(0);
  }
  if (flag("resolve") === "true") {
    console.log(JSON.stringify(await resolveDisputes(parallelClient(), tickers, { log: (l) => console.log(l) })));
    process.exit(0);
  }
  const out = await deepen(parallelClient(), tickers, { only, dry: flag("dry") === "true", force: flag("force") === "true", checksOnly: flag("checks-only") === "true", vote: flag("vote") === "true", asOf: flag("as-of") ?? today(), log: (l) => console.log(l) });
  console.log(JSON.stringify(out));
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
