/**
 * Creates all monitors via the Parallel Monitor API with structured output.
 * Saves monitor IDs to src/data/monitors.json for the app to use.
 *
 * Usage: npx tsx scripts/setup-monitors.ts
 */

import * as fs from "fs";
import { MONITOR_DEFS, MONITOR_OUTPUT_SCHEMA } from "./monitor-configs";

const API_KEY =
  process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";

async function createMonitor(def: (typeof MONITOR_DEFS)[number]) {
  const metadata: Record<string, string> = {
    demo_id: def.id,
    name: def.name,
    class: def.class,
  };
  if (def.region) metadata.region = def.region;
  if (def.facilityCode) metadata.facilityCode = def.facilityCode;
  if (def.states) metadata.states = def.states.join(",");

  const body = {
    type: "event_stream",
    frequency: def.frequency,
    settings: {
      query: def.query,
      processor: def.processor,
      output_schema: MONITOR_OUTPUT_SCHEMA,
    },
    metadata,
  };

  const res = await fetch(`${BASE_URL}/v1/monitors`, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      `Failed to create monitor ${def.id}: ${res.status} ${err}`
    );
  }

  return res.json();
}

async function main() {
  console.log(`Creating ${MONITOR_DEFS.length} monitors with structured output...\n`);

  const results: Record<
    string,
    {
      monitorId: string;
      name: string;
      class: string;
      query: string;
      frequency: string;
      region?: string;
      facilityCode?: string;
      states?: string[];
    }
  > = {};

  for (const def of MONITOR_DEFS) {
    try {
      const result = await createMonitor(def);
      const monitorId = result.monitor_id;
      results[def.id] = {
        monitorId,
        name: def.name,
        class: def.class,
        query: def.query,
        frequency: def.frequency,
        region: def.region,
        facilityCode: def.facilityCode,
        states: def.states,
      };
      console.log(
        `  ✓ ${def.id.padEnd(28)} → ${monitorId}  (${def.states?.join(",") || "national"})`
      );
    } catch (e) {
      console.error(`  ✗ ${def.id}:`, (e as Error).message);
    }
  }

  const outPath = "./src/data/monitors.json";
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  const regionCount = Object.values(results).filter(
    (r) => r.class === "region"
  ).length;
  const facilityCount = Object.values(results).filter(
    (r) => r.class === "facility"
  ).length;
  const discoveryCount = Object.values(results).filter(
    (r) => r.class === "discovery"
  ).length;

  console.log(
    `\nCreated ${Object.keys(results).length} monitors: ${regionCount} region, ${facilityCount} facility, ${discoveryCount} discovery`
  );
  console.log(`Saved to ${outPath}`);
}

main().catch(console.error);
