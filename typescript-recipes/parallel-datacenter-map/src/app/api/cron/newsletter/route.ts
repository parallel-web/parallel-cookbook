import { NextRequest, NextResponse } from "next/server";
import { list, put } from "@vercel/blob";
import { writeNewsletter, wrapEmailTemplate } from "@/lib/newsletter-writer";
import {
  fetchMonitorEvents,
  getIssueNumber,
  buildPrompt,
} from "../../newsletter/generate/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const API_KEY = process.env.PARALLEL_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const BASE_URL = "https://api.parallel.ai";

/**
 * Cron-triggered newsletter pipeline. Each invocation advances the state:
 *
 *   not_found → kick off research (Task API ultra-fast)
 *   researching → check if research done
 *   research done → run Claude agent writer → save
 *   writing → skip (another invocation is handling it)
 *   completed → skip
 *
 * Schedule: every 15 min on Mondays (vercel.json). Typical completion: ~30 min.
 */
export async function GET(request: NextRequest) {
  // Verify Vercel Cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!API_KEY || !BLOB_TOKEN) {
    return NextResponse.json({ error: "Missing API_KEY or BLOB_TOKEN" }, { status: 500 });
  }

  const issueNumber = getIssueNumber();

  // ─── Check current state in Blob ───
  let data: Record<string, unknown> | null = null;
  try {
    const { blobs } = await list({ prefix: `newsletters/issue-${issueNumber}`, token: BLOB_TOKEN });
    if (blobs.length > 0) {
      const res = await fetch(blobs[0].downloadUrl, { headers: { Authorization: `Bearer ${BLOB_TOKEN}` } });
      if (res.ok) data = await res.json();
    }
  } catch {}

  // ─── Already complete ───
  if (data?.content) {
    return NextResponse.json({ action: "none", reason: "already_done", issueNumber });
  }

  // ─── Writing in progress (another invocation is handling it) ───
  if (data?.phase === "writing") {
    const writingStart = new Date((data.writingStartedAt as string) || "0").getTime();
    if (Date.now() - writingStart < 6 * 60 * 1000) {
      return NextResponse.json({ action: "waiting", phase: "writing", issueNumber });
    }
    // Stale writing — fall through to re-check research
  }

  // ─── Research in progress — check if done ───
  if (data?.runId) {
    const statusRes = await fetch(`${BASE_URL}/v1/tasks/runs/${data.runId}`, {
      headers: { "x-api-key": API_KEY },
    });
    if (!statusRes.ok) {
      return NextResponse.json({ action: "waiting", phase: "research", issueNumber });
    }

    const statusData = await statusRes.json();

    if (statusData.status === "completed") {
      // Research done — fetch result and trigger writing
      const resultRes = await fetch(`${BASE_URL}/v1/tasks/runs/${data.runId}/result`, {
        headers: { "x-api-key": API_KEY },
      });
      if (!resultRes.ok) {
        return NextResponse.json({ action: "error", reason: "result_fetch_failed", issueNumber });
      }

      const result = await resultRes.json();
      const rawContent = result.output?.content;
      const research = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent) || "";
      const interactionId = statusData.interaction_id || data.runId;

      if (!ANTHROPIC_KEY) {
        return NextResponse.json({ action: "error", reason: "no_anthropic_key", issueNumber });
      }

      // Mark as writing
      await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify({
        ...data, phase: "writing", writingStartedAt: new Date().toISOString(),
      }), { access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN });

      try {
        // Fetch events for regional roundup
        const events = await fetchMonitorEvents();
        const regions = new Map<string, typeof events>();
        for (const e of events) {
          if (!regions.has(e.monitorName)) regions.set(e.monitorName, []);
          regions.get(e.monitorName)!.push(e);
        }

        const bodyHtml = await writeNewsletter({
          research,
          interactionId: interactionId as string,
          issueNumber,
          eventsTotal: events.length,
          criticalCount: events.filter((e) => e.severity === "critical").length,
          marketsActive: regions.size,
          regionSummaries: Array.from(regions.entries())
            .map(([name, evts]) => `${name} (${evts.length} events): ${evts[0]?.headline || ""}`)
            .join("\n"),
          parallelApiKey: API_KEY,
          anthropicApiKey: ANTHROPIC_KEY,
        });

        const emailHtml = wrapEmailTemplate(bodyHtml, issueNumber);
        const issueData = {
          issueNumber, content: bodyHtml, emailHtml,
          generatedAt: new Date().toISOString(), status: "completed",
        };

        await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify(issueData), {
          access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN,
        });

        return NextResponse.json({ action: "completed", issueNumber });
      } catch (error) {
        console.error("[cron/newsletter] Writing failed:", error);
        // Reset to research phase for retry on next cron invocation
        await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify({
          ...data, phase: "research",
        }), { access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN });
        return NextResponse.json({ action: "error", reason: "writing_failed", issueNumber });
      }
    }

    if (statusData.status === "failed") {
      return NextResponse.json({ action: "error", reason: "research_failed", issueNumber });
    }

    return NextResponse.json({ action: "waiting", phase: "research", issueNumber });
  }

  // ─── No issue started — kick off research ───
  const events = await fetchMonitorEvents();
  const prompt = buildPrompt(events);

  const taskRes = await fetch(`${BASE_URL}/v1/tasks/runs`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: prompt,
      task_spec: {
        output_schema: {
          type: "text",
          description: "Comprehensive factual research with specific data points, dates, numbers, and source URLs for each critical event.",
        },
      },
      processor: "ultra-fast",
    }),
  });

  if (!taskRes.ok) {
    return NextResponse.json({ action: "error", reason: "task_api_failed", issueNumber });
  }

  const task = await taskRes.json();

  await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify({
    issueNumber, runId: task.run_id, status: "generating", phase: "research",
    startedAt: new Date().toISOString(),
    stats: { events: events.length, critical: events.filter((e) => e.severity === "critical").length },
  }), { access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN });

  return NextResponse.json({ action: "started", phase: "research", runId: task.run_id, issueNumber });
}
