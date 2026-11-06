/**
 * Runs the call-day pipeline for one call without waiting for a monitor:
 * Search → Extract → match → (update Task run if the sheet does not cover
 * the call yet) → gate → publish.
 *
 *   pnpm callday META --date 2026-10-21 --quarter "Q3 2026"
 *   pnpm callday META --date 2026-10-21 --quarter "Q3 2026" --force-update
 *   pnpm callday META --date 2026-10-21 --quarter "Q3 2026" --redo   re-read a handled call, keep its trigger
 *   pnpm callday F --date 2026-10-28 --quarter "Q3 2026" --regate   re-run the gate on the call's update run (no new Task run)
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { readManifest } from "../src/sheet/stored";
import { readCallDay, writeRaw } from "../src/store";
import { finishUpdate, startCallDay } from "../src/updates/update";
import { flag, loadEnv, positional } from "./lib/env";

loadEnv();
const [ticker] = positional();
const date = flag("date");
const quarter = flag("quarter");
if (!ticker || !date || !quarter) {
  console.error('usage: pnpm callday <TICKER> --date YYYY-MM-DD --quarter "Q3 2026" [--force-update]');
  process.exit(1);
}
const client = parallelClient();
if (flag("regate") === "true") {
  // Re-gate the stored update run, e.g. after a gate rule change. Reads the result back; fills only new gaps.
  const record = readCallDay(ticker.toUpperCase(), date);
  const runId = record?.update?.runId;
  if (!runId) {
    console.error(`No update run recorded for ${ticker} ${date}`);
    process.exit(1);
  }
  const manifest = readManifest(ticker.toUpperCase())!;
  writeRaw(ticker.toUpperCase(), "manifest", "latest", {
    ...manifest,
    updates: manifest.updates.map((u) => (u.runId === runId ? { ...u, status: undefined } : u)),
  });
  const { published } = await finishUpdate(client, ticker.toUpperCase(), runId, null, (line) => console.log(line));
  console.log(`${ticker} ${date}: ${published ? "published" : "held"}`);
  process.exit(0);
}
try {
  const record = await startCallDay(
    client,
    ticker.toUpperCase(),
    { date, quarter },
    { kind: "manual", monitorId: null, eventId: null, eventGroupId: null, eventDate: null, content: null, citations: [] },
    { webhookUrl: null, wait: true, log: (line) => console.log(line), forceUpdate: flag("force-update") === "true", redo: flag("redo") === "true" },
  );
  console.log(`${record.ticker} ${record.callDate}: ${record.status}`);
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
