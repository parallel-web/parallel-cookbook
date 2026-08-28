#!/usr/bin/env npx tsx
/**
 * Recreate ONLY the currently-referenced snapshot monitors (src/data/snapshot-monitors.json)
 * at daily (1d) frequency. The API has no PATCH, so we create replacements and rewrite the map.
 * Scoped to the referenced set (not all 1,939 enrichment runs) to keep the demo's monitor
 * footprint sane.
 *
 * Usage: PARALLEL_API_KEY=xxx npx tsx scripts/snapshots-to-daily.ts
 */
import * as fs from "fs";

const API_KEY = process.env.PARALLEL_API_KEY;
if (!API_KEY) { console.error("Set PARALLEL_API_KEY"); process.exit(1); }
const BASE_URL = "https://api.parallel.ai";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const PATH = "./src/data/snapshot-monitors.json";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const current = JSON.parse(fs.readFileSync(PATH, "utf-8")) as Record<string, { monitorId: string; runId: string; facilityName: string }>;
  const entries = Object.entries(current);
  console.log(`Recreating ${entries.length} referenced snapshot monitors at 1d...`);

  const out: typeof current = {};
  let done = 0, failed = 0;
  for (const [idx, snap] of entries) {
    const res = await fetch(`${BASE_URL}/v1/monitors`, {
      method: "POST",
      headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "snapshot", frequency: "1d", processor: "base",
        settings: { task_run_id: snap.runId },
        ...(WEBHOOK_URL ? { webhook: { url: WEBHOOK_URL, event_types: ["monitor.event.detected"] } } : {}),
        metadata: { facility_name: snap.facilityName.slice(0, 100), facility_index: idx, type: "datacenter-snapshot" },
      }),
    });
    if (res.ok) {
      const d = await res.json();
      out[idx] = { monitorId: d.monitor_id, runId: snap.runId, facilityName: snap.facilityName };
      done++;
    } else {
      out[idx] = snap; // keep old on failure so we never lose an entry
      failed++;
    }
    if ((done + failed) % 25 === 0) {
      fs.writeFileSync(PATH, JSON.stringify(out, null, 2));
      process.stdout.write(`\r  ${done} recreated, ${failed} failed / ${entries.length}`);
    }
    await sleep(250);
  }
  fs.writeFileSync(PATH, JSON.stringify(out, null, 2));
  console.log(`\nDone: ${done} recreated at 1d, ${failed} failed (kept old).`);
  fs.writeFileSync("/tmp/snapshots-daily.done", "ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
