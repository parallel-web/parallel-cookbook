/**
 * Runs the call-day pipeline for one call without waiting for a monitor:
 * Search → Extract → match → (update Task run if the sheet does not cover
 * the call yet) → gate → publish, then stages 2 and 3 where due.
 *
 *   pnpm callday META --date 2026-10-21 --quarter "Q3 2026"
 *   pnpm callday META --date 2026-10-21 --quarter "Q3 2026" --force-update
 *   pnpm callday META --date 2026-10-21 --quarter "Q3 2026" --redo   re-read a handled call, keep its trigger
 *   pnpm callday F --date 2026-10-28 --quarter "Q3 2026" --regate   re-run the gate on the call's update run (no new Task run)
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { drive } from "../src/pipeline/drive";
import { readCallDay, withLock } from "../src/store";
import { finishUpdate, startCallDay } from "../src/updates/update";
import { flag, loadEnv, positional } from "./lib/env";

loadEnv();
const [arg] = positional();
const date = flag("date");
const quarter = flag("quarter");
if (!arg || !date || !quarter) {
  console.error('usage: pnpm callday <TICKER> --date YYYY-MM-DD --quarter "Q3 2026" [--force-update]');
  process.exit(1);
}
const ticker = arg.toUpperCase();
const log = (line: string) => console.log(line);
try {
  const client = parallelClient();
  if (flag("regate") === "true") {
    // Re-gate the stored update run, e.g. after a gate rule change. Reads the result back; fills only new gaps.
    const runId = (await readCallDay(ticker, date, flag("event")))?.update?.runId;
    if (!runId) throw new Error(`No update run recorded for ${ticker} ${date}`);
    const { published } = await withLock(ticker, () => finishUpdate(client, ticker, runId, null, log));
    console.log(`${ticker} ${date}: ${published ? "published" : "held"}`);
  } else {
    const record = await withLock(ticker, () =>
      startCallDay(
        client,
        ticker,
        { date, quarter },
        { kind: "manual", monitorId: null, eventId: null, eventGroupId: null, eventDate: null, content: null, citations: [] },
        { log, forceUpdate: flag("force-update") === "true", redo: flag("redo") === "true" },
      ),
    );
    console.log(`${record.ticker} ${record.callDate}: ${record.status}`);
    await drive(client, [ticker], log);
  }
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
