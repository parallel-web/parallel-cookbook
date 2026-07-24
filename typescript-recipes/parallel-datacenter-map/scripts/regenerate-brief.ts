#!/usr/bin/env npx tsx
/**
 * Regenerate the current week's Datacenter Signal issue with DENSE citations.
 *
 * Builds a large citation pool from (a) every monitor event's basis citations
 * and (b) the deep-research run's own basis, then hands it to the enhanced
 * writer which is instructed to hyperlink aggressively. All real Task API data.
 *
 * Usage: PARALLEL_API_KEY=.. ANTHROPIC_API_KEY=.. BLOB_READ_WRITE_TOKEN=.. \
 *   npx tsx scripts/regenerate-brief.ts
 */
import * as fs from "fs";
import { put } from "@vercel/blob";
import { writeNewsletter, wrapEmailTemplate } from "../src/lib/newsletter-writer";
import monitorsData from "../src/data/monitors.json";

const API_KEY = process.env.PARALLEL_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const BASE_URL = "https://api.parallel.ai";

function getIssueNumber() {
  return Math.floor((Date.now() - new Date("2024-01-01").getTime()) / (7 * 24 * 60 * 60 * 1000));
}
function weekOf(n: number): string {
  const ms = new Date("2024-01-01").getTime() + n * 7 * 24 * 60 * 60 * 1000;
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

interface Evt { headline: string; summary: string; category: string; severity: string; eventDate: string; affectedEntities: string; monitorName: string; citations: { title: string; url: string }[]; }

async function fetchMonitorEvents() {
  const monitors = monitorsData as Record<string, { monitorId: string; name: string }>;
  const all: Evt[] = [];
  const pool: { title: string; url: string }[] = [];
  for (const [, info] of Object.entries(monitors)) {
    try {
      const res = await fetch(`${BASE_URL}/v1/monitors/${info.monitorId}/events`, { headers: { "x-api-key": API_KEY }, cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      for (const evt of data.events || []) {
        const c = evt.output?.content;
        if (!c || typeof c !== "object") continue;
        const basis = evt.output?.basis || [];
        const cites = basis.flatMap((b: { citations?: { title?: string; url?: string }[] }) =>
          (b.citations || []).map((x) => ({ title: x.title || "", url: x.url || "" }))).filter((x: { url: string }) => x.url);
        pool.push(...cites);
        all.push({ headline: c.headline || "", summary: c.summary || "", category: c.category || "", severity: c.severity || "informational", eventDate: evt.event_date || "", affectedEntities: c.affected_entities || "", monitorName: info.name, citations: cites.slice(0, 3) });
      }
    } catch {}
  }
  return { all, pool };
}

function buildPrompt(events: Evt[], issueNumber: number) {
  const critical = events.filter((e) => e.severity === "critical").slice(0, 6);
  const regions = new Map<string, Evt[]>();
  for (const e of events) { if (!regions.has(e.monitorName)) regions.set(e.monitorName, []); regions.get(e.monitorName)!.push(e); }
  let cs = "";
  for (const e of critical) {
    cs += `\n### ${e.headline}\nRegion: ${e.monitorName} | Category: ${e.category} | Date: ${e.eventDate}\n${e.summary}\n`;
    if (e.affectedEntities) cs += `Affects: ${e.affectedEntities}\n`;
    if (e.citations.length) cs += `Sources: ${e.citations.map((c) => `${c.title} (${c.url})`).join("; ")}\n`;
  }
  const rs = Array.from(regions.entries()).slice(0, 12).map(([n, e]) => `- **${n}** (${e.length} events): ${e[0].headline}`).join("\n");
  return `Write "Datacenter Signal — Issue ${issueNumber}" (Week of ${weekOf(issueNumber)}), a weekly infrastructure intelligence brief for datacenter investors.

CRITICAL EVENTS THIS WEEK (deep-research each one, and surface as many primary sources with URLs as possible):
${cs || "No critical events this week."}

ALL EVENTS SUMMARY: ${events.length} total, ${critical.length} critical, ${regions.size} markets.

REGIONAL ACTIVITY:
${rs}

Return comprehensive factual research with specific data points, dates, dollar figures, and — critically — the source URL for every claim. Include as many distinct primary sources as possible.`;
}

async function main() {
  const issueNumber = getIssueNumber();
  console.log(`Regenerating issue ${issueNumber} (Week of ${weekOf(issueNumber)}) with dense citations...`);

  console.log("Fetching monitor events + citation pool...");
  const { all: events, pool: eventPool } = await fetchMonitorEvents();
  console.log(`${events.length} events, ${eventPool.length} raw event citations`);

  console.log("Kicking off Task API deep research (ultra-fast)...");
  const taskRes = await fetch(`${BASE_URL}/v1/tasks/runs`, {
    method: "POST", headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ input: buildPrompt(events, issueNumber), task_spec: { output_schema: { type: "text", description: "Comprehensive factual research with specific data points, dates, numbers, and a source URL for every claim." } }, processor: "ultra-fast" }),
  });
  if (!taskRes.ok) { console.error("Task API failed:", await taskRes.text()); process.exit(1); }
  const { run_id } = await taskRes.json();
  console.log("Research run:", run_id);

  let research = "", interactionId = run_id;
  const researchPool: { title: string; url: string }[] = [];
  const start = Date.now();
  while (Date.now() - start < 20 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 6000));
    const s = await fetch(`${BASE_URL}/v1/tasks/runs/${run_id}`, { headers: { "x-api-key": API_KEY } });
    if (!s.ok) continue;
    const sd = await s.json();
    if (sd.status === "completed") {
      interactionId = sd.interaction_id || run_id;
      const rr = await (await fetch(`${BASE_URL}/v1/tasks/runs/${run_id}/result`, { headers: { "x-api-key": API_KEY } })).json();
      const raw = rr.output?.content;
      research = typeof raw === "string" ? raw : JSON.stringify(raw) || "";
      for (const b of rr.output?.basis || []) for (const c of b.citations || []) if (c.url) researchPool.push({ title: c.title || "", url: c.url });
      break;
    }
    if (sd.status === "failed" || sd.status === "cancelled") { console.error("research", sd.status); process.exit(1); }
  }
  if (!research) { console.error("research timed out"); process.exit(1); }
  console.log(`research done (${research.length} chars, ${researchPool.length} research citations)`);

  const regions = new Map<string, Evt[]>();
  for (const e of events) { if (!regions.has(e.monitorName)) regions.set(e.monitorName, []); regions.get(e.monitorName)!.push(e); }

  // Combined, deduped citation pool: research basis first (most relevant), then event citations
  const pool = Array.from(new Map([...researchPool, ...eventPool].filter((c) => c.url).map((c) => [c.url, c])).values());
  console.log(`combined citation pool: ${pool.length} distinct sources`);

  console.log("Writing with enhanced writer (dense citations)...");
  const bodyHtml = await writeNewsletter({
    research, interactionId, issueNumber,
    eventsTotal: events.length, criticalCount: events.filter((e) => e.severity === "critical").length,
    marketsActive: regions.size,
    regionSummaries: Array.from(regions.entries()).map(([n, e]) => `${n} (${e.length} events): ${e[0]?.headline || ""}`).join("\n"),
    parallelApiKey: API_KEY, anthropicApiKey: ANTHROPIC_KEY, citationPool: pool,
  });

  const linkCount = (bodyHtml.match(/<a\s/gi) || []).length;
  console.log(`body: ${bodyHtml.length} chars, ${linkCount} inline links`);

  const issueData = {
    issueNumber, content: bodyHtml, emailHtml: wrapEmailTemplate(bodyHtml, issueNumber),
    weekOf: weekOf(issueNumber), researchRunId: run_id, interactionId,
    stats: { events: events.length, critical: events.filter((e) => e.severity === "critical").length, markets: regions.size, sources: pool.length, links: linkCount },
    generatedAt: new Date().toISOString(), status: "completed",
  };
  await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify(issueData), { access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN });
  console.log(`✓ stored issue ${issueNumber} (${linkCount} links, ${pool.length} sources available)`);
  fs.writeFileSync("/tmp/regen-brief.done", "ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
