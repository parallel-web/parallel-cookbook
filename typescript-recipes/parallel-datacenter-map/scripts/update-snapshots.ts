/**
 * Recreates snapshot monitors with updated settings (1d frequency, base processor).
 * The API doesn't support PATCH/PUT, so we create new monitors and update the IDs.
 *
 * Usage: PARALLEL_API_KEY=xxx npx tsx scripts/update-snapshots.ts
 */

import * as fs from "fs";

const API_KEY = process.env.PARALLEL_API_KEY;
if (!API_KEY) { console.error("Set PARALLEL_API_KEY"); process.exit(1); }

const BASE_URL = "https://api.parallel.ai";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const runsPath = "./src/data/enrichment-v2-runs.json";
  if (!fs.existsSync(runsPath)) { console.error("No enrichment-v2-runs.json"); process.exit(1); }

  const snapshotPath = "./src/data/snapshot-monitors.json";
  const runData = JSON.parse(fs.readFileSync(runsPath, "utf-8"));

  console.log(`Recreating ${runData.runs.length} snapshot monitors (1d, base)...\n`);

  const newSnapshots: Record<string, { monitorId: string; runId: string; facilityName: string }> = {};
  let created = 0, failed = 0;

  for (const run of runData.runs) {
    const res = await fetch(`${BASE_URL}/v1/monitors`, {
      method: "POST",
      headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "snapshot",
        frequency: "1d",
        processor: "base",
        settings: { task_run_id: run.runId },
        ...(WEBHOOK_URL ? { webhook: { url: WEBHOOK_URL, event_types: ["monitor.event.detected"] } } : {}),
        metadata: {
          facility_name: run.facilityName.slice(0, 100),
          facility_index: String(run.facilityIndex),
          type: "datacenter-snapshot",
        },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      newSnapshots[String(run.facilityIndex)] = {
        monitorId: data.monitor_id,
        runId: run.runId,
        facilityName: run.facilityName,
      };
      created++;
    } else {
      failed++;
    }

    if ((created + failed) % 50 === 0) {
      fs.writeFileSync(snapshotPath, JSON.stringify(newSnapshots, null, 2));
      process.stdout.write(`\r  Created: ${created}, Failed: ${failed} / ${runData.runs.length}`);
    }

    await sleep(300); // Rate limit
  }

  fs.writeFileSync(snapshotPath, JSON.stringify(newSnapshots, null, 2));
  console.log(`\n\nDone: ${created} created, ${failed} failed`);
  console.log(`Saved to ${snapshotPath}`);
}

main().catch(console.error);
