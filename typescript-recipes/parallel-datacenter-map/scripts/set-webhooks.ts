/**
 * Updates all monitors to use webhook delivery.
 * Pass the public URL as an argument.
 *
 * Usage: npx tsx scripts/set-webhooks.ts https://your-app.vercel.app
 */

import * as fs from "fs";

const API_KEY =
  process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";

async function main() {
  const appUrl = process.argv[2];
  if (!appUrl) {
    console.error("Usage: npx tsx scripts/set-webhooks.ts <PUBLIC_URL>");
    console.error("Example: npx tsx scripts/set-webhooks.ts https://datacenter-map-demo.vercel.app");
    process.exit(1);
  }

  const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/webhook`;
  console.log(`Setting webhook URL: ${webhookUrl}\n`);

  const monitorsPath = "./src/data/monitors.json";
  const monitors = JSON.parse(fs.readFileSync(monitorsPath, "utf-8"));

  for (const [defId, info] of Object.entries(monitors) as [string, { monitorId: string; name: string }][]) {
    try {
      const res = await fetch(
        `${BASE_URL}/v1/monitors/${info.monitorId}/update`,
        {
          method: "POST",
          headers: {
            "x-api-key": API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            webhook: {
              url: webhookUrl,
              event_types: ["monitor.event.detected"],
            },
          }),
        }
      );

      if (res.ok) {
        console.log(`  ✓ ${info.name}`);
      } else {
        const err = await res.text();
        console.error(`  ✗ ${info.name}: ${res.status} ${err.slice(0, 100)}`);
      }
    } catch (e) {
      console.error(`  ✗ ${info.name}: ${(e as Error).message}`);
    }
  }

  console.log(`\nDone. All monitors will POST to ${webhookUrl}`);
  console.log("Events will stream to clients via SSE at /api/webhook (GET)");
}

main().catch(console.error);
