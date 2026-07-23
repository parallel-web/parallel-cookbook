#!/usr/bin/env npx tsx
/**
 * Resume a Datacenter Signal issue whose Task API research run is already
 * in-flight (or done): poll the existing run, then run the Claude writer and
 * store to Vercel Blob. Avoids re-kicking research that's already running.
 *
 * Usage:
 *   ... npx tsx scripts/finish-issue.ts <issueNumber> <runId> "<focus>"
 */

import * as fs from "fs";
import { put, list } from "@vercel/blob";
import { writeNewsletter, wrapEmailTemplate } from "../src/lib/newsletter-writer";
import monitorsData from "../src/data/monitors.json";

const API_KEY = process.env.PARALLEL_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const BASE_URL = "https://api.parallel.ai";

function weekOf(n: number): string {
  const ms = new Date("2024-01-01").getTime() + n * 7 * 24 * 60 * 60 * 1000;
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

async function fetchMonitorEvents() {
  const monitors = monitorsData as Record<string, { monitorId: string; name: string; class: string }>;
  const all: { headline: string; monitorName: string; severity: string }[] = [];
  const full = new Map<string, { headline: string; monitorName: string; severity: string }[]>();
  for (const [, info] of Object.entries(monitors)) {
    try {
      const res = await fetch(`${BASE_URL}/v1/monitors/${info.monitorId}/events`, { headers: { "x-api-key": API_KEY }, cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      for (const evt of data.events || []) {
        const c = evt.output?.content;
        if (!c || typeof c !== "object") continue;
        const e = { headline: c.headline || "", monitorName: info.name, severity: c.severity || "informational" };
        all.push(e);
        if (!full.has(info.name)) full.set(info.name, []);
        full.get(info.name)!.push(e);
      }
    } catch {}
  }
  return { all, regions: full };
}

async function main() {
  const issueNumber = parseInt(process.argv[2]);
  const runId = process.argv[3];
  const focus = process.argv[4] || "";
  if (!issueNumber || !runId) { console.error("Pass <issueNumber> <runId> [focus]"); process.exit(1); }

  const existing = await list({ prefix: `newsletters/issue-${issueNumber}`, token: BLOB_TOKEN });
  if (existing.blobs.length) {
    const r = await fetch(existing.blobs[0].downloadUrl, { headers: { Authorization: `Bearer ${BLOB_TOKEN}` } });
    if (r.ok && (await r.json()).content) { console.log(`[${issueNumber}] already done`); fs.writeFileSync(`/tmp/issue-${issueNumber}.done`, "ok"); return; }
  }

  console.log(`[${issueNumber}] Polling existing run ${runId}...`);
  let research = "", interactionId = runId;
  const start = Date.now();
  while (Date.now() - start < 20 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 6000));
    const s = await fetch(`${BASE_URL}/v1/tasks/runs/${runId}`, { headers: { "x-api-key": API_KEY } });
    if (!s.ok) continue;
    const sd = await s.json();
    if (sd.status === "completed") {
      interactionId = sd.interaction_id || runId;
      const rr = await fetch(`${BASE_URL}/v1/tasks/runs/${runId}/result`, { headers: { "x-api-key": API_KEY } });
      const raw = (await rr.json()).output?.content;
      research = typeof raw === "string" ? raw : JSON.stringify(raw) || "";
      break;
    }
    if (sd.status === "failed" || sd.status === "cancelled") { console.error(`[${issueNumber}] run ${sd.status}`); process.exit(1); }
  }
  if (!research) { console.error(`[${issueNumber}] research timed out`); process.exit(1); }
  console.log(`[${issueNumber}] research done (${research.length} chars). Writing...`);

  const { all, regions } = await fetchMonitorEvents();
  const bodyHtml = await writeNewsletter({
    research, interactionId, issueNumber,
    eventsTotal: all.length,
    criticalCount: all.filter((e) => e.severity === "critical").length,
    marketsActive: regions.size,
    regionSummaries: Array.from(regions.entries()).map(([name, evts]) => `${name} (${evts.length} events): ${evts[0]?.headline || ""}`).join("\n"),
    parallelApiKey: API_KEY, anthropicApiKey: ANTHROPIC_KEY,
  });

  const issueData = {
    issueNumber, content: bodyHtml, emailHtml: wrapEmailTemplate(bodyHtml, issueNumber),
    focus, weekOf: weekOf(issueNumber), researchRunId: runId, interactionId,
    stats: { events: all.length, critical: all.filter((e) => e.severity === "critical").length, markets: regions.size },
    generatedAt: new Date().toISOString(), status: "completed",
  };
  await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify(issueData), {
    access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN,
  });
  console.log(`[${issueNumber}] ✓ stored (${bodyHtml.length} chars)`);
  fs.writeFileSync(`/tmp/issue-${issueNumber}.done`, "ok");
}

main().catch((e) => { console.error(e); process.exit(1); });
