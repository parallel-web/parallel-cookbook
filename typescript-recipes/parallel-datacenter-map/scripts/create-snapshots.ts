/**
 * Creates snapshot monitors for all enrichment runs.
 * Each monitor watches one facility's enrichment for changes daily (1d).
 * Uses v2 run IDs (most complete enrichment).
 *
 * Usage: npx tsx scripts/create-snapshots.ts
 */

import * as fs from "fs";

const API_KEY =
  process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";

// Deployed webhook URL — update after deployment
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
if (!WEBHOOK_URL) console.warn("Warning: WEBHOOK_URL not set. Snapshots won't push events to the app.");

interface RunEntry {
  runId: string;
  groupId: string;
  facilityIndex: number;
  facilityName: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createSnapshotMonitor(
  taskRunId: string,
  facilityName: string,
  facilityIndex: number
): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/v1/monitors`, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "snapshot",
      frequency: "1d",
      processor: "base",
      settings: { task_run_id: taskRunId },
      webhook: {
        url: WEBHOOK_URL,
        event_types: ["monitor.event.detected"],
      },
      metadata: {
        facility_name: facilityName.slice(0, 100),
        facility_index: String(facilityIndex),
        type: "datacenter-snapshot",
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`  ✗ [${facilityIndex}] ${facilityName}: ${res.status} ${err.slice(0, 150)}`);
    return null;
  }

  const data = await res.json();
  return data.monitor_id;
}

async function main() {
  // Use v2 run IDs (most complete enrichment)
  const runsPath = "./src/data/enrichment-v2-runs.json";
  if (!fs.existsSync(runsPath)) {
    console.error("No enrichment-v2-runs.json found.");
    process.exit(1);
  }

  const runData = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
  const runs: RunEntry[] = runData.runs;

  console.log(`Creating snapshot monitors for ${runs.length} facilities...`);
  console.log(`Webhook: ${WEBHOOK_URL}`);
  console.log(`Rate limit: ~300/min, pacing at ~200/min\n`);

  // Load existing snapshots to resume
  const snapshotPath = "./src/data/snapshot-monitors.json";
  let snapshots: Record<string, { monitorId: string; runId: string; facilityName: string }> = {};
  if (fs.existsSync(snapshotPath)) {
    snapshots = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const key = String(run.facilityIndex);

    // Skip if already has a snapshot
    if (snapshots[key]) {
      skipped++;
      continue;
    }

    const monitorId = await createSnapshotMonitor(
      run.runId,
      run.facilityName,
      run.facilityIndex
    );

    if (monitorId) {
      snapshots[key] = {
        monitorId,
        runId: run.runId,
        facilityName: run.facilityName,
      };
      created++;
    } else {
      failed++;
    }

    // Save every 50
    if ((created + failed) % 50 === 0 && (created + failed) > 0) {
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshots, null, 2));
      process.stdout.write(
        `\r  Progress: ${i + 1}/${runs.length} | Created: ${created} | Skipped: ${skipped} | Failed: ${failed}`
      );
    }

    // Rate limit: ~200/min = 1 every 300ms
    await sleep(300);
  }

  // Final save
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshots, null, 2));

  console.log(`\n\n=== DONE ===`);
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total snapshots: ${Object.keys(snapshots).length}`);
  console.log(`Saved to ${snapshotPath}`);
}

main().catch(console.error);
