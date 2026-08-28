#!/usr/bin/env npx tsx
/**
 * Seed a back-issue of Datacenter Signal directly from real monitor events.
 *
 * The events themselves come from the Parallel Task API monitors (real
 * headlines, summaries, categories, and source citations). Claude composes
 * them into a themed newsletter body in ONE call — no dependency on the
 * (currently slow) deep-research runs or the multi-turn lookup loop that was
 * truncating output. Nothing is fabricated: every fact traces to a monitor
 * event and its cited source.
 *
 * Usage:
 *   ... npx tsx scripts/seed-issue.ts <issueNumber> "<focus>"
 */

import * as fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { put, list } from "@vercel/blob";
import { wrapEmailTemplate } from "../src/lib/newsletter-writer";
import monitorsData from "../src/data/monitors.json";

const API_KEY = process.env.PARALLEL_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const BASE_URL = "https://api.parallel.ai";

function weekOf(n: number): string {
  const ms = new Date("2024-01-01").getTime() + n * 7 * 24 * 60 * 60 * 1000;
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

interface Evt {
  headline: string; summary: string; category: string; severity: string;
  eventDate: string; affectedEntities: string; monitorName: string;
  citations: { title: string; url: string }[];
}

async function fetchMonitorEvents(): Promise<Evt[]> {
  const monitors = monitorsData as Record<string, { monitorId: string; name: string }>;
  const all: Evt[] = [];
  for (const [, info] of Object.entries(monitors)) {
    try {
      const res = await fetch(`${BASE_URL}/v1/monitors/${info.monitorId}/events`, { headers: { "x-api-key": API_KEY }, cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      for (const evt of data.events || []) {
        const c = evt.output?.content;
        if (!c || typeof c !== "object") continue;
        const basis = evt.output?.basis || [];
        const citations = basis.flatMap((b: { citations?: { title?: string; url?: string }[] }) =>
          (b.citations || []).map((x) => ({ title: x.title || "", url: x.url || "" }))).filter((x: {url: string}) => x.url).slice(0, 3);
        all.push({
          headline: c.headline || "", summary: c.summary || "", category: c.category || "",
          severity: c.severity || "informational", eventDate: evt.event_date || "",
          affectedEntities: c.affected_entities || "", monitorName: info.name, citations,
        });
      }
    } catch {}
  }
  return all;
}

const SYSTEM = `You are the editor of "Datacenter Signal," a weekly intelligence brief for datacenter infrastructure investors. Transform the supplied monitor events into a polished HTML newsletter body.

VOICE: Analytical, concise, data-anchored — like a Financial Times or Stratechery briefing. No hype, no speculation, no emoji.

STRUCTURE:
1. An issue line: <p style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#858483;margin:0 0 24px">Issue N &mdash; Week of DATE</p>
2. "The Week in One Read" — 2-3 sentence executive summary anchored on the editorial focus
3. "Critical Developments" — 3-4 of the most important events (lead with ones matching the focus). For each: a category tag, a bold headline, and 2 paragraphs of analysis (what happened, stakeholders, implications, what to watch). Weave the provided source links inline using the publication name as anchor text.
4. "Regional Roundup" — one line per active region
5. "By the Numbers" — 6-10 key data points

Use ONLY the supplied events as facts. Do not invent numbers, deals, or quotes beyond what the events state. If an event lacks a citation, state the fact without a link.

HTML (inline styles only):
- H2: <h2 style="font-size:17px;font-weight:500;color:#1D1B16;margin:24px 0 8px;padding-bottom:5px;border-bottom:1px solid #E5E5E5">
- Body: <p style="font-size:14px;line-height:22px;color:#5C5B59;margin:0 0 10px">
- Links: <a href="URL" style="color:#FB631B;text-decoration:none">
- Bold: <strong style="color:#1D1B16;font-weight:500">
- Lists: <ul style="padding-left:18px;margin:0 0 12px"><li style="font-size:14px;line-height:22px;color:#5C5B59;margin-bottom:4px">
- Category tag: <span style="font-family:'Courier New',monospace;font-size:8px;text-transform:uppercase;letter-spacing:0.05em;font-weight:500;padding:2px 6px;border-radius:2px;color:#fff;background:#FB631B">CATEGORY</span>
- Divider between the summary and Critical Developments: <div style="border-top:2px solid #FB631B;margin:28px 0 24px"></div>

OUTPUT: Return ONLY the HTML body. No markdown, no code fences, no preamble.`;

async function main() {
  const issueNumber = parseInt(process.argv[2]);
  const focus = process.argv[3] || "The most consequential developments of the week";
  if (!issueNumber) { console.error("Pass <issueNumber> [focus]"); process.exit(1); }

  const existing = await list({ prefix: `newsletters/issue-${issueNumber}`, token: BLOB_TOKEN });
  if (existing.blobs.length) {
    const r = await fetch(existing.blobs[0].downloadUrl, { headers: { Authorization: `Bearer ${BLOB_TOKEN}` } });
    if (r.ok && (await r.json()).content) { console.log(`[${issueNumber}] already done`); fs.writeFileSync(`/tmp/issue-${issueNumber}.done`, "ok"); return; }
  }

  console.log(`[${issueNumber}] Fetching monitor events...`);
  const events = await fetchMonitorEvents();
  const critical = events.filter((e) => e.severity === "critical");
  const notable = events.filter((e) => e.severity === "notable");
  const regions = new Map<string, Evt[]>();
  for (const e of events) { if (!regions.has(e.monitorName)) regions.set(e.monitorName, []); regions.get(e.monitorName)!.push(e); }
  console.log(`[${issueNumber}] ${events.length} events (${critical.length} critical). Composing with Claude...`);

  const evtBlock = (e: Evt) => {
    let s = `- [${e.severity.toUpperCase()}] ${e.headline}\n  Region: ${e.monitorName} | Category: ${e.category} | Date: ${e.eventDate}\n  ${e.summary}`;
    if (e.affectedEntities) s += `\n  Affects: ${e.affectedEntities}`;
    if (e.citations.length) s += `\n  Sources: ${e.citations.map((c) => `${c.title} — ${c.url}`).join(" ; ")}`;
    return s;
  };

  const userMsg = `Issue ${issueNumber} — Week of ${weekOf(issueNumber)}
EDITORIAL FOCUS: ${focus}

CRITICAL EVENTS:
${critical.slice(0, 12).map(evtBlock).join("\n")}

NOTABLE EVENTS:
${notable.slice(0, 15).map(evtBlock).join("\n")}

REGIONAL ACTIVITY (events per region):
${Array.from(regions.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 14).map(([n, e]) => `- ${n}: ${e.length} events; lead: ${e[0].headline}`).join("\n")}

TOTALS: ${events.length} events, ${critical.length} critical, ${regions.size} active markets.

Write the HTML body for Issue ${issueNumber} now, leading with developments relevant to the editorial focus.`;

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-5", max_tokens: 16000, system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });
  let bodyHtml = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
  const fence = bodyHtml.match(/```html\s*([\s\S]*?)```/);
  if (fence) bodyHtml = fence[1].trim();

  if (bodyHtml.length < 1500) { console.error(`[${issueNumber}] output too short (${bodyHtml.length} chars):\n${bodyHtml}`); process.exit(1); }

  const issueData = {
    issueNumber, content: bodyHtml, emailHtml: wrapEmailTemplate(bodyHtml, issueNumber),
    focus, weekOf: weekOf(issueNumber),
    stats: { events: events.length, critical: critical.length, markets: regions.size },
    generatedAt: new Date().toISOString(), status: "completed",
  };
  await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify(issueData), {
    access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN,
  });
  console.log(`[${issueNumber}] ✓ stored (${bodyHtml.length} chars)`);
  fs.writeFileSync(`/tmp/issue-${issueNumber}.done`, "ok");
}

main().catch((e) => { console.error(e); process.exit(1); });
