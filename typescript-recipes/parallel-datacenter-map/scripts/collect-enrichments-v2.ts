/**
 * Collects v2 enrichment results and merges with v1.
 * Saves combined enrichments to public/data/enrichments.json.
 *
 * Usage: npx tsx scripts/collect-enrichments-v2.ts
 */

import * as fs from "fs";

const API_KEY =
  process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";

async function checkGroupStatus(groupId: string) {
  const res = await fetch(`${BASE_URL}/v1/tasks/groups/${groupId}`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchResult(runId: string) {
  const statusRes = await fetch(`${BASE_URL}/v1/tasks/runs/${runId}`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!statusRes.ok) return null;
  const statusData = await statusRes.json();
  if (statusData.status !== "completed") return null;

  const resultRes = await fetch(`${BASE_URL}/v1/tasks/runs/${runId}/result`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!resultRes.ok) return null;
  return resultRes.json();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const runsPath = "./src/data/enrichment-v2-runs.json";
  if (!fs.existsSync(runsPath)) {
    console.error("No enrichment-v2-runs.json. Run run-enrichment-v2.ts first.");
    process.exit(1);
  }

  const runData = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
  console.log(`Collecting v2 results for ${runData.runs.length} runs...\n`);

  for (const group of runData.groups) {
    const status = await checkGroupStatus(group.groupId);
    if (status) {
      console.log(`Group ${group.groupId}: ${JSON.stringify(status.status?.task_run_status_counts)}`);
    }
  }
  console.log();

  // Load existing v1 enrichments
  const enrichPath = "./public/data/enrichments.json";
  const enrichments = JSON.parse(fs.readFileSync(enrichPath, "utf-8"));
  console.log(`Existing v1 enrichments: ${Object.keys(enrichments).length}\n`);

  // Track v2 collection
  let collected = 0;
  let pending = 0;
  const CONCURRENCY = 20;

  for (let i = 0; i < runData.runs.length; i += CONCURRENCY) {
    const batch = runData.runs.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (run: { runId: string; facilityIndex: number; facilityName: string }) => {
        // Skip if v2 already merged
        const existing = enrichments[String(run.facilityIndex)];
        if (existing?.enrichment?.verified_operator) return null;

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
      const v2Content = r.result?.output?.content;
      if (!v2Content) continue;

      const key = String(r.run.facilityIndex);
      const existing = enrichments[key];

      if (existing) {
        // Merge v2 fields into existing v1 enrichment
        existing.enrichment = {
          ...existing.enrichment,
          ...v2Content,
        };
        // Merge v2 basis into existing basis
        const v2Basis = r.result?.output?.basis || [];
        if (Array.isArray(v2Basis)) {
          existing.basis = [...(existing.basis || []), ...v2Basis];
        }
        existing.v2RunId = r.run.runId;
        existing.v2CollectedAt = new Date().toISOString();
      } else {
        enrichments[key] = {
          runId: r.run.runId,
          facilityName: r.run.facilityName,
          facilityIndex: r.run.facilityIndex,
          enrichment: v2Content,
          basis: r.result?.output?.basis || [],
          collectedAt: new Date().toISOString(),
        };
      }
      collected++;
    }

    if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= runData.runs.length) {
      fs.writeFileSync(enrichPath, JSON.stringify(enrichments, null, 2));
      process.stdout.write(
        `\r  Collected: ${collected} new v2, ${pending} pending`
      );
    }

    await sleep(100);
  }

  fs.writeFileSync(enrichPath, JSON.stringify(enrichments, null, 2));
  console.log(`\n\nDone. ${collected} v2 enrichments merged.`);
  console.log(`${pending} still pending.`);

  // Show sample
  const sample = enrichments["0"];
  if (sample?.enrichment) {
    const e = sample.enrichment;
    console.log(`\nSample (facility 0):`);
    console.log(`  verified_operator: ${e.verified_operator || "?"}`);
    console.log(`  verified_owner: ${e.verified_owner || "?"}`);
    console.log(`  cooling_type: ${e.cooling_type || "?"}`);
    console.log(`  utility_provider: ${e.utility_provider || "?"}`);
    console.log(`  campus_acres: ${e.campus_acres || "?"}`);
    console.log(`  expansion_capacity_mw: ${e.expansion_capacity_mw || "?"}`);
    console.log(`  community_opposition: ${e.community_opposition || "?"}`);
  }
}

main().catch(console.error);
