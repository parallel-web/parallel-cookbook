/**
 * Collects enrichment results from completed Task API runs.
 * Reads run IDs from src/data/enrichment-runs.json, fetches results,
 * saves to public/data/enrichments.json.
 *
 * Can be run multiple times — only fetches completed runs, skips others.
 *
 * Usage: npx tsx scripts/collect-enrichments.ts
 */

import * as fs from "fs";

const API_KEY =
  process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";

interface EnrichmentRun {
  runId: string;
  groupId: string;
  facilityIndex: number;
  facilityName: string;
}

interface EnrichmentData {
  groups: { groupId: string; batchIndex: number; size: number }[];
  runs: EnrichmentRun[];
  startedAt: string;
  processor: string;
  totalFacilities: number;
}

async function checkGroupStatus(groupId: string) {
  const res = await fetch(`${BASE_URL}/v1/tasks/groups/${groupId}`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchResult(runId: string) {
  // Check status first
  const statusRes = await fetch(`${BASE_URL}/v1/tasks/runs/${runId}`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!statusRes.ok) return null;
  const statusData = await statusRes.json();
  if (statusData.status !== "completed") return null;

  // Fetch full result
  const resultRes = await fetch(
    `${BASE_URL}/v1/tasks/runs/${runId}/result`,
    { headers: { "x-api-key": API_KEY } }
  );
  if (!resultRes.ok) return null;
  return resultRes.json();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const runsPath = "./src/data/enrichment-runs.json";
  if (!fs.existsSync(runsPath)) {
    console.error("No enrichment-runs.json found. Run run-enrichment.ts first.");
    process.exit(1);
  }

  const data: EnrichmentData = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
  console.log(`Collecting results for ${data.runs.length} enrichment runs...\n`);

  // Check group status first
  for (const group of data.groups) {
    const status = await checkGroupStatus(group.groupId);
    if (status) {
      console.log(`Group ${group.groupId}: ${JSON.stringify(status.status?.task_run_status_counts)}`);
    }
  }
  console.log();

  // Load existing enrichments (for incremental collection)
  const enrichPath = "./public/data/enrichments.json";
  let enrichments: Record<string, unknown> = {};
  if (fs.existsSync(enrichPath)) {
    enrichments = JSON.parse(fs.readFileSync(enrichPath, "utf-8"));
  }
  const existingCount = Object.keys(enrichments).length;
  console.log(`Existing enrichments: ${existingCount}\n`);

  // Fetch results in parallel batches
  const CONCURRENCY = 20;
  let completed = 0;
  let failed = 0;
  let pending = 0;

  for (let i = 0; i < data.runs.length; i += CONCURRENCY) {
    const batch = data.runs.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (run) => {
        // Skip if already collected
        if (enrichments[String(run.facilityIndex)]) return null;

        const result = await fetchResult(run.runId);
        if (!result) {
          pending++;
          return null;
        }

        return { run, result };
      })
    );

    for (const r of results) {
      if (!r) continue;

      const content = r.result?.output?.content;
      if (content) {
        enrichments[String(r.run.facilityIndex)] = {
          runId: r.run.runId,
          facilityName: r.run.facilityName,
          facilityIndex: r.run.facilityIndex,
          enrichment: content,
          basis: r.result?.output?.basis,
          collectedAt: new Date().toISOString(),
        };
        completed++;
      } else {
        failed++;
      }
    }

    // Save incrementally every 100 results
    if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= data.runs.length) {
      fs.writeFileSync(enrichPath, JSON.stringify(enrichments, null, 2));
      const total = Object.keys(enrichments).length;
      process.stdout.write(
        `\r  Collected: ${total}/${data.runs.length} (${completed} new, ${pending} pending, ${failed} failed)`
      );
    }

    // Small delay to avoid rate limits
    await sleep(100);
  }

  const totalCollected = Object.keys(enrichments).length;
  console.log(
    `\n\nDone. ${totalCollected}/${data.runs.length} enrichments collected.`
  );
  console.log(`Saved to ${enrichPath}`);

  if (totalCollected < data.runs.length) {
    console.log(
      `\n${data.runs.length - totalCollected} runs still pending. Run this script again later.`
    );
  }
}

main().catch(console.error);
