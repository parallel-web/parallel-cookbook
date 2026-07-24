/**
 * Check for events from all active monitors.
 * Usage: npx tsx scripts/check-events.ts
 */

import * as fs from "fs";

const API_KEY = process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";

async function main() {
  const monitorsPath = "./src/data/monitors.json";
  if (!fs.existsSync(monitorsPath)) {
    console.error("No monitors.json found. Run setup-monitors.ts first.");
    process.exit(1);
  }

  const monitors = JSON.parse(fs.readFileSync(monitorsPath, "utf-8"));

  for (const [defId, info] of Object.entries(monitors) as [string, { monitorId: string; name: string }][]) {
    console.log(`\n--- ${info.name} (${info.monitorId}) ---`);

    const res = await fetch(
      `${BASE_URL}/v1/monitors/${info.monitorId}/events`,
      { headers: { "x-api-key": API_KEY } }
    );

    if (!res.ok) {
      console.error(`  Error: ${res.status} ${await res.text()}`);
      continue;
    }

    const data = await res.json();
    const events = data.events || [];

    if (events.length === 0) {
      console.log("  No events yet.");
    } else {
      for (const evt of events) {
        console.log(`  [${evt.type}] ${evt.event_id}`);
        if (evt.output?.content) {
          const content = typeof evt.output.content === "string"
            ? evt.output.content.slice(0, 200)
            : JSON.stringify(evt.output.content).slice(0, 200);
          console.log(`    ${content}...`);
        }
      }
    }
  }
}

main().catch(console.error);
