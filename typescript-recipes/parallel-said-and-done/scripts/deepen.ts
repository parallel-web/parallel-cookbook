/**
 * Stages 2 and 3 for published sheets, wherever they are due: a history run
 * (trail@1) for each promise without one, an independent fact-check (check@2)
 * for each outcome without a current one, two more checks for a disputed
 * outcome, and a resolution run (resolve@1) when most checks dispute it. Then
 * the gate, and a new version if anything changed.
 *
 *   pnpm deepen              every company
 *   pnpm deepen MSFT GM      some companies
 *   pnpm deepen --redo TSLA:P1,BLK:P2 [--clear-only]
 *                            redo these promises' histories (and so their checks), e.g. after a
 *                            spec change; --clear-only leaves the runs to the deployment's reconcile
 *
 * The rules are src/pipeline/advance.ts; the deployment applies them after every run.
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { advance } from "../src/pipeline/advance";
import { drive } from "../src/pipeline/drive";
import { eachLimit } from "../src/pipeline/reconcile";
import { readManifest, writeManifest } from "../src/sheet/stored";
import { readCoverageConfig, withLock } from "../src/store";
import { flag, loadEnv, positional } from "./lib/env";

loadEnv();
const redo = flag("redo")?.split(",").map((s) => s.trim().toUpperCase().split(":") as [string, string]);
const picked = positional().map((t) => t.toUpperCase());
const tickers = redo ? [...new Set(redo.map(([t]) => t))] : picked.length ? picked : readCoverageConfig().companies.map((c) => c.ticker);
const log = (line: string) => console.log(line);
try {
  // Forget the chosen histories and their checks; advance then starts new ones on the current specs.
  for (const [t, pid] of redo ?? []) {
    await withLock(t, async () => {
      const m = await readManifest(t);
      if (!m?.trails?.[pid]) return log(`${t} ${pid}: no history to redo`);
      const trails = { ...m.trails };
      const checks = { ...m.checks };
      const failures = { ...m.failures };
      const resolves = { ...m.resolves };
      const disputed = { ...m.disputed };
      delete trails[pid];
      delete checks[pid];
      delete resolves[pid];
      delete disputed[pid];
      for (const k of Object.keys(failures)) if (k.endsWith(`:${pid}`)) delete failures[k];
      await writeManifest(t, { ...m, trails, checks, failures, resolves, disputed });
      log(`${t} ${pid}: history cleared`);
    });
  }
  if (flag("clear-only") === "true") process.exit(0);
  const client = parallelClient();
  await eachLimit(tickers, 4, async (t) => {
    if (await readManifest(t)) await withLock(t, () => advance(client, t, log));
  });
  await drive(client, tickers, log);
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
