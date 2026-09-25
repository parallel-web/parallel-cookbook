import { NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import monitorsData from "@/data/monitors.json";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min timeout for Vercel

const API_KEY = process.env.PARALLEL_API_KEY || "";
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const BASE_URL = "https://api.parallel.ai";

function getIssueNumber() {
  return Math.floor((Date.now() - new Date("2024-01-01").getTime()) / (7 * 24 * 60 * 60 * 1000));
}

async function fetchMonitorEvents() {
  const monitors = monitorsData as Record<string, { monitorId: string; name: string; class: string }>;
  const allEvents: { headline: string; summary: string; category: string; severity: string; eventDate: string; affectedEntities: string; monitorName: string; citations: { title: string; url: string }[] }[] = [];

  for (const [, info] of Object.entries(monitors)) {
    try {
      const res = await fetch(`${BASE_URL}/v1/monitors/${info.monitorId}/events`, {
        headers: { "x-api-key": API_KEY }, cache: "no-store",
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const evt of data.events || []) {
        const content = evt.output?.content;
        if (!content || typeof content !== "object") continue;
        const basis = evt.output?.basis || [];
        const citations = basis.flatMap((b: { citations?: { title?: string; url?: string }[] }) =>
          (b.citations || []).map((c) => ({ title: c.title || "", url: c.url || "" }))
        ).slice(0, 3);
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

function buildPrompt(events: Awaited<ReturnType<typeof fetchMonitorEvents>>) {
  const critical = events.filter((e) => e.severity === "critical").slice(0, 5);
  const regions = new Map<string, typeof events>();
  for (const e of events) {
    if (!regions.has(e.monitorName)) regions.set(e.monitorName, []);
    regions.get(e.monitorName)!.push(e);
  }
  const issueNumber = getIssueNumber();

  let criticalSection = "";
  for (const evt of critical) {
    criticalSection += `\n### ${evt.headline}\nRegion: ${evt.monitorName} | Category: ${evt.category} | Date: ${evt.eventDate}\n${evt.summary}\n`;
    if (evt.affectedEntities) criticalSection += `Affects: ${evt.affectedEntities}\n`;
    if (evt.citations.length > 0) criticalSection += `Sources: ${evt.citations.map((c) => `${c.title} (${c.url})`).join("; ")}\n`;
  }

  let regionalSection = "";
  for (const [name, evts] of Array.from(regions.entries()).slice(0, 12)) {
    regionalSection += `- **${name}** (${evts.length} events): ${evts[0].headline}\n`;
  }

  return `Write "Datacenter Signal — Issue ${issueNumber}", a weekly infrastructure intelligence brief for datacenter investors.

CRITICAL EVENTS THIS WEEK (deep-research each one):
${criticalSection || "No critical events this week."}

ALL EVENTS SUMMARY:
- Total events detected: ${events.length}
- Critical: ${critical.length}
- Markets with activity: ${regions.size}

REGIONAL ACTIVITY:
${regionalSection || "No regional activity."}

INSTRUCTIONS:
1. Open with "The week in one read" — 2-3 sentence executive summary
2. "Critical developments" — thorough analysis of each critical event with background, stakeholders, implications, and what to watch
3. "Regional roundup" — one line per active region
4. "By the numbers" — key stats

Tone: analytical, concise, data-anchored. Like a Financial Times briefing. No hype, no speculation.
Format: clean markdown with ## headers, bullet points, and [inline source links](url). No emoji.`;
}

function markdownToEmailHtml(md: string): string {
  let html = md;
  html = html.replace(/&/g, "&amp;");

  // Convert [N] refs to inline links if references section exists
  const refSection = html.split("## References");
  if (refSection.length > 1) {
    const refs: Record<string, { title: string; url: string }> = {};
    for (const line of refSection[1].split("\n")) {
      const m = line.match(/^(\d+)\.\s+\*(.+?)\*\.\s+(https?:\/\/\S+)/);
      if (m) refs[m[1]] = { title: m[2], url: m[3] };
    }
    html = refSection[0];
    html = html.replace(/\[(\d+)\]/g, (_, num) => {
      const ref = refs[num];
      if (ref) {
        const domain = ref.url.split("/")[2]?.replace("www.", "").split(".")[0] || "source";
        return `(<a href="${ref.url}" style="color:#FB631B">${domain}</a>)`;
      }
      return `[${num}]`;
    });
  }

  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:15px;font-weight:500;color:#1D1B16;margin:18px 0 6px">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:17px;font-weight:500;color:#1D1B16;margin:24px 0 8px;padding-bottom:5px;border-bottom:1px solid #E5E5E5">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:20px;font-weight:500;color:#1D1B16;margin:28px 0 10px">$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#1D1B16;font-weight:500">$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em style="color:#858483">$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#FB631B;text-decoration:none">$1</a>');
  html = html.replace(/^- (.+)$/gm, '<li style="font-size:14px;line-height:22px;color:#5C5B59;margin-bottom:4px">$1</li>');
  html = html.replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/g, '<ul style="padding-left:18px;margin:0 0 12px">$1</ul>');
  html = html.replace(/\n\n/g, '</p><p style="font-size:14px;line-height:22px;color:#5C5B59;margin:0 0 10px">');
  html = html.replace(/\n/g, "<br>");
  html = '<p style="font-size:14px;line-height:22px;color:#5C5B59;margin:0 0 10px">' + html + "</p>";

  return `<div style="max-width:644px;margin:0 auto;background:#fff;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="padding:28px 30px 18px;border-bottom:1px solid #E5E5E5;background:#FCFBFA">
<div style="font-family:'Courier New',monospace;font-weight:700;font-size:18px;color:#1D1B16;margin-bottom:14px">parallel</div>
<div style="display:flex;justify-content:space-between;align-items:baseline">
<span style="font-family:'Courier New',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#1D1B16">Datacenter Signal</span>
<span style="font-family:'Courier New',monospace;font-size:9px;color:#A6A5A4">Issue ${getIssueNumber()}</span>
</div></div>
<div style="padding:24px 30px">${html}</div>
<div style="padding:24px 30px;background:#FCFBFA;border-top:1px solid #E5E5E5">
<div style="font-family:'Courier New',monospace;font-weight:700;font-size:13px;color:#1D1B16;opacity:0.6;margin-bottom:8px">parallel</div>
<div style="font-family:'Courier New',monospace;font-size:9px;color:#A6A5A4">hello@parallel.ai · Palo Alto, CA</div>
</div></div>`;
}

// POST: kick off newsletter generation — returns immediately with runId
// The preview endpoint polls for completion and finalizes (save + send)
export async function POST() {
  if (!API_KEY) return NextResponse.json({ error: "No API key" }, { status: 500 });

  const issueNumber = getIssueNumber();

  // Check if already generated
  if (BLOB_TOKEN) {
    try {
      const { blobs } = await list({ prefix: `newsletters/issue-${issueNumber}`, token: BLOB_TOKEN });
      if (blobs.length > 0) {
        const res = await fetch(blobs[0].downloadUrl, { headers: { Authorization: `Bearer ${BLOB_TOKEN}` } });
        if (res.ok) {
          const existing = await res.json();
          if (existing.content) return NextResponse.json({ status: "already_generated", ...existing });
          // If we have a runId but no content, it's still generating
          if (existing.runId) return NextResponse.json({ status: "generating", runId: existing.runId, issueNumber });
        }
      }
    } catch {}
  }

  // Fetch monitor events and kick off Task API
  const events = await fetchMonitorEvents();
  const prompt = buildPrompt(events);

  const taskRes = await fetch(`${BASE_URL}/v1/tasks/runs`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: prompt,
      task_spec: { output_schema: { type: "text", description: "Markdown-formatted weekly datacenter intelligence brief with inline citations." } },
      processor: "ultra-fast",
    }),
  });

  if (!taskRes.ok) return NextResponse.json({ error: await taskRes.text() }, { status: 500 });
  const task = await taskRes.json();

  // Save the pending state to Blob immediately (so we don't re-kick on next request)
  if (BLOB_TOKEN) {
    await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify({
      issueNumber, runId: task.run_id, status: "generating", phase: "research", startedAt: new Date().toISOString(),
      stats: { events: events.length, critical: events.filter((e) => e.severity === "critical").length },
    }), { access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN });
  }

  return NextResponse.json({ status: "generating", runId: task.run_id, issueNumber });
}

// Exported for use by the preview route
export { markdownToEmailHtml, getIssueNumber, fetchMonitorEvents, buildPrompt };
