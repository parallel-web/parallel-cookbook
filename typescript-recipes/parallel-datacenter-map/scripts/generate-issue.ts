#!/usr/bin/env npx tsx
/**
 * Generate a single Datacenter Signal issue for a given issue number and store
 * it to Vercel Blob (same shape the app's /api/newsletter pipeline writes).
 *
 * Real Task API deep research + Claude writer — nothing fabricated. Used to
 * seed the newsletter archive with a few back-issues so the reader has issues
 * to click through. Each issue takes an editorial "focus" so back-issues read
 * distinctly even though they draw from the same live monitor pool.
 *
 * Usage:
 *   PARALLEL_API_KEY=.. ANTHROPIC_API_KEY=.. BLOB_READ_WRITE_TOKEN=.. \
 *     npx tsx scripts/generate-issue.ts <issueNumber> "<focus>"
 */

import * as fs from "fs";
import { put, list } from "@vercel/blob";
import { writeNewsletter, wrapEmailTemplate } from "../src/lib/newsletter-writer";
import monitorsData from "../src/data/monitors.json";

const API_KEY = process.env.PARALLEL_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const BASE_URL = "https://api.parallel.ai";

if (!API_KEY || !ANTHROPIC_KEY || !BLOB_TOKEN) {
  console.error("Need PARALLEL_API_KEY, ANTHROPIC_API_KEY, BLOB_READ_WRITE_TOKEN.");
  process.exit(1);
}

function weekOf(issueNumber: number): string {
  const ms = new Date("2024-01-01").getTime() + issueNumber * 7 * 24 * 60 * 60 * 1000;
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

async function fetchMonitorEvents() {
  const monitors = monitorsData as Record<string, { monitorId: string; name: string; class: string }>;
  const allEvents: { headline: string; summary: string; category: string; severity: string; eventDate: string; affectedEntities: string; monitorName: string; citations: { title: string; url: string }[] }[] = [];
  for (const [, info] of Object.entries(monitors)) {
    try {
      const res = await fetch(`${BASE_URL}/v1/monitors/${info.monitorId}/events`, { headers: { "x-api-key": API_KEY }, cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      for (const evt of data.events || []) {
        const content = evt.output?.content;
        if (!content || typeof content !== "object") continue;
        const basis = evt.output?.basis || [];
        const citations = basis.flatMap((b: { citations?: { title?: string; url?: string }[] }) =>
          (b.citations || []).map((c) => ({ title: c.title || "", url: c.url || "" }))).slice(0, 3);
        allEvents.push({
          headline: content.headline || "", summary: content.summary || "",
          category: content.category || "", severity: content.severity || "informational",
          eventDate: evt.event_date || "", affectedEntities: content.affected_entities || "",
          monitorName: info.name, citations,
        });
      }
    } catch {}
  }
  return allEvents;
}

function buildPrompt(events: Awaited<ReturnType<typeof fetchMonitorEvents>>, issueNumber: number, focus: string) {
  const critical = events.filter((e) => e.severity === "critical").slice(0, 6);
  const regions = new Map<string, typeof events>();
  for (const e of events) {
    if (!regions.has(e.monitorName)) regions.set(e.monitorName, []);
    regions.get(e.monitorName)!.push(e);
  }
  let criticalSection = "";
  for (const evt of critical) {
    criticalSection += `\n### ${evt.headline}\nRegion: ${evt.monitorName} | Category: ${evt.category} | Date: ${evt.eventDate}\n${evt.summary}\n`;
    if (evt.affectedEntities) criticalSection += `Affects: ${evt.affectedEntities}\n`;
    if (evt.citations.length) criticalSection += `Sources: ${evt.citations.map((c) => `${c.title} (${c.url})`).join("; ")}\n`;
  }
  let regionalSection = "";
  for (const [name, evts] of Array.from(regions.entries()).slice(0, 12)) {
    regionalSection += `- **${name}** (${evts.length} events): ${evts[0].headline}\n`;
  }

  return `Write "Datacenter Signal — Issue ${issueNumber}" (Week of ${weekOf(issueNumber)}), a weekly infrastructure intelligence brief for datacenter investors.

EDITORIAL FOCUS FOR THIS ISSUE: ${focus}
Lead the issue with the developments most relevant to that focus. Do not omit other critical items, but frame the "week in one read" and lead story around the focus.

CRITICAL EVENTS THIS WEEK (deep-research each one):
${criticalSection || "No critical events this week."}

ALL EVENTS SUMMARY:
- Total events detected: ${events.length}
- Critical: ${critical.length}
- Markets with activity: ${regions.size}

REGIONAL ACTIVITY:
${regionalSection || "No regional activity."}

INSTRUCTIONS:
1. Open with "The Week in One Read" — 2-3 sentence executive summary anchored on the editorial focus
2. "Critical Developments" — thorough analysis of each critical event with background, stakeholders, implications, and what to watch
3. "Regional Roundup" — one line per active region
4. "By the Numbers" — key stats

Tone: analytical, concise, data-anchored, like a Financial Times briefing. No hype, no speculation. Weave inline source links into prose using publication names. No emoji. No numbered references like [1].`;
}

async function main() {
  const issueNumber = parseInt(process.argv[2]);
  const focus = process.argv[3] || "The most consequential developments of the week";
  if (!issueNumber) { console.error("Pass an issue number."); process.exit(1); }

  // Skip if already fully generated
  const { blobs } = await list({ prefix: `newsletters/issue-${issueNumber}`, token: BLOB_TOKEN });
  if (blobs.length) {
    const res = await fetch(blobs[0].downloadUrl, { headers: { Authorization: `Bearer ${BLOB_TOKEN}` } });
    if (res.ok && (await res.json()).content) { console.log(`Issue ${issueNumber} already generated. Skipping.`); return; }
  }

  console.log(`[${issueNumber}] Fetching monitor events...`);
  const events = await fetchMonitorEvents();
  console.log(`[${issueNumber}] ${events.length} events. Kicking off Task API research (ultra-fast)...`);

  const taskRes = await fetch(`${BASE_URL}/v1/tasks/runs`, {
    method: "POST", headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: buildPrompt(events, issueNumber, focus),
      task_spec: { output_schema: { type: "text", description: "Comprehensive factual research with specific data points, dates, numbers, and source URLs for each critical event." } },
      processor: "ultra-fast",
    }),
  });
  if (!taskRes.ok) { console.error(`[${issueNumber}] Task API failed: ${await taskRes.text()}`); process.exit(1); }
  const { run_id } = await taskRes.json();
  console.log(`[${issueNumber}] Research run: ${run_id}`);

  // Poll research
  let research = "", interactionId = run_id;
  const start = Date.now();
  while (Date.now() - start < 8 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await fetch(`${BASE_URL}/v1/tasks/runs/${run_id}`, { headers: { "x-api-key": API_KEY } });
    if (!s.ok) continue;
    const sd = await s.json();
    if (sd.status === "completed") {
      interactionId = sd.interaction_id || run_id;
      const rr = await fetch(`${BASE_URL}/v1/tasks/runs/${run_id}/result`, { headers: { "x-api-key": API_KEY } });
      const raw = (await rr.json()).output?.content;
      research = typeof raw === "string" ? raw : JSON.stringify(raw) || "";
      break;
    }
    if (sd.status === "failed") { console.error(`[${issueNumber}] Research failed`); process.exit(1); }
  }
  if (!research) { console.error(`[${issueNumber}] Research timed out`); process.exit(1); }
  console.log(`[${issueNumber}] Research done (${research.length} chars). Writing with Claude...`);

  const regions = new Map<string, typeof events>();
  for (const e of events) { if (!regions.has(e.monitorName)) regions.set(e.monitorName, []); regions.get(e.monitorName)!.push(e); }

  const bodyHtml = await writeNewsletter({
    research, interactionId, issueNumber,
    eventsTotal: events.length,
    criticalCount: events.filter((e) => e.severity === "critical").length,
    marketsActive: regions.size,
    regionSummaries: Array.from(regions.entries()).map(([name, evts]) => `${name} (${evts.length} events): ${evts[0]?.headline || ""}`).join("\n"),
    parallelApiKey: API_KEY, anthropicApiKey: ANTHROPIC_KEY,
  });

  const emailHtml = wrapEmailTemplate(bodyHtml, issueNumber);
  const issueData = {
    issueNumber, content: bodyHtml, emailHtml, focus, weekOf: weekOf(issueNumber),
    researchRunId: run_id, interactionId,
    stats: { events: events.length, critical: events.filter((e) => e.severity === "critical").length, markets: regions.size },
    generatedAt: new Date().toISOString(), status: "completed",
  };
  await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify(issueData), {
    access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN,
  });
  console.log(`[${issueNumber}] ✓ Stored to blob (${bodyHtml.length} chars body).`);
  fs.writeFileSync(`/tmp/issue-${issueNumber}.done`, "ok");
}

main().catch((e) => { console.error(e); process.exit(1); });
