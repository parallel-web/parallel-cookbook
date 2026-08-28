/**
 * Runs Task API deep research for each of the 16 monitor topics.
 * This backfills the event feed with recent past events.
 *
 * Usage: npx tsx scripts/run-backfill.ts
 *
 * Uses "pro" processor for deep research (2-10 min per query).
 * Results are saved to src/data/backfill-events.json
 */

import * as fs from "fs";
import { MONITOR_DEFS } from "./monitor-configs";

const API_KEY = process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";

const OUTPUT_SCHEMA = {
  type: "json" as const,
  json_schema: {
    type: "object" as const,
    properties: {
      events: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            headline: {
              type: "string" as const,
              description: "Short headline summarizing the event (under 100 chars)",
            },
            description: {
              type: "string" as const,
              description:
                "2-3 sentence description of what happened, including specific numbers, dates, and entities involved",
            },
            date: {
              type: "string" as const,
              description: "Approximate date of the event (YYYY-MM-DD or YYYY-MM)",
            },
            category: {
              type: "string" as const,
              description: "Event category",
              enum: [
                "POWER & GRID",
                "OWNERSHIP",
                "NEW SITE",
                "PERMITS",
                "EXPANSION",
                "COMMUNITY",
                "WATER",
                "POLICY",
              ],
            },
            affected_facilities: {
              type: "string" as const,
              description:
                "Names or codes of specific data center facilities affected, if identifiable",
            },
            source_name: {
              type: "string" as const,
              description: "Name of the primary source (e.g., 'Virginia SCC Filing', 'County Board Minutes')",
            },
            source_url: {
              type: "string" as const,
              description: "URL of the primary source, or empty string if not available",
            },
          },
          required: [
            "headline",
            "description",
            "date",
            "category",
            "affected_facilities",
            "source_name",
            "source_url",
          ],
          additionalProperties: false,
        },
      },
      summary: {
        type: "string" as const,
        description:
          "Brief overall summary of the current landscape for this region/facility (2-3 sentences)",
      },
    },
    required: ["events", "summary"],
    additionalProperties: false,
  },
};

async function createTaskRun(query: string, name: string) {
  const body = {
    input: `Find the most significant recent developments (last 3 months) related to: ${query}\n\nFocus on concrete events with dates, specific entities, and verifiable details. Include regulatory filings, zoning decisions, utility actions, community opposition, construction milestones, and ownership changes. Return up to 8 of the most material events.`,
    task_spec: {
      output_schema: OUTPUT_SCHEMA,
    },
    processor: "pro",
    metadata: { demo_backfill: true, monitor_name: name },
  };

  const res = await fetch(`${BASE_URL}/v1/tasks/runs`, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create task for ${name}: ${res.status} ${err}`);
  }

  return res.json();
}

async function pollForResult(
  runId: string,
  name: string,
  maxWaitMs = 600000 // 10 minutes
): Promise<Record<string, unknown> | null> {
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < maxWaitMs) {
    attempt++;
    const res = await fetch(`${BASE_URL}/v1/tasks/runs/${runId}`, {
      headers: { "x-api-key": API_KEY },
    });

    if (!res.ok) {
      console.error(`  Poll error for ${name}: ${res.status}`);
      await sleep(5000);
      continue;
    }

    const data = await res.json();

    if (data.status === "completed") {
      // Fetch full result with output from /result endpoint
      const resultRes = await fetch(`${BASE_URL}/v1/tasks/runs/${runId}/result`, {
        headers: { "x-api-key": API_KEY },
      });
      if (resultRes.ok) {
        const resultData = await resultRes.json();
        return { ...data, output: resultData.output };
      }
      return data;
    }
    if (data.status === "failed") {
      console.error(`  Task failed for ${name}:`, data.error);
      return null;
    }

    // Still running — wait with increasing delay
    const delay = Math.min(5000 + attempt * 2000, 15000);
    process.stdout.write(`  [${name}] status=${data.status}, waiting ${delay / 1000}s...\r`);
    await sleep(delay);
  }

  console.error(`  Timeout waiting for ${name}`);
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const concurrency = 4; // run 4 at a time to avoid rate limits
  const allResults: Record<string, unknown>[] = [];

  console.log(`Starting backfill for ${MONITOR_DEFS.length} topics (${concurrency} concurrent)...\n`);

  // Submit all tasks first
  const submissions: { def: (typeof MONITOR_DEFS)[number]; runId: string }[] = [];

  for (const def of MONITOR_DEFS) {
    try {
      const result = await createTaskRun(def.query, def.name);
      submissions.push({ def, runId: result.run_id });
      console.log(`  Submitted: ${def.name} → ${result.run_id}`);
    } catch (e) {
      console.error(`  Failed to submit ${def.name}:`, (e as Error).message);
    }
    // Small delay between submissions
    await sleep(500);
  }

  console.log(`\nWaiting for ${submissions.length} tasks to complete...\n`);

  // Poll in batches
  for (let i = 0; i < submissions.length; i += concurrency) {
    const batch = submissions.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async ({ def, runId }) => {
        const result = await pollForResult(runId, def.name);
        if (result) {
          console.log(`\n✓ ${def.name} completed`);
          return {
            monitorDefId: def.id,
            monitorName: def.name,
            monitorClass: def.class,
            region: def.region,
            facilityCode: def.facilityCode,
            runId,
            ...result,
          };
        }
        console.log(`\n✗ ${def.name} failed or timed out`);
        return null;
      })
    );

    allResults.push(
      ...batchResults.filter((r): r is Record<string, unknown> => r !== null)
    );
  }

  const outPath = "./src/data/backfill-results.json";
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`\nSaved ${allResults.length} backfill results to ${outPath}`);
}

main().catch(console.error);
