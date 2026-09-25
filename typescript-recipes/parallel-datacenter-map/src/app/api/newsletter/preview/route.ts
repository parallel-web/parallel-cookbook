import { NextRequest, NextResponse } from "next/server";
import { list, put } from "@vercel/blob";
import { writeNewsletter, wrapEmailTemplate } from "@/lib/newsletter-writer";
import {
  fetchMonitorEvents,
  getIssueNumber,
  markdownToEmailHtml,
} from "../generate/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — needed for Claude agent writing phase

const API_KEY = process.env.PARALLEL_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const BASE_URL = "https://api.parallel.ai";

// GET: fetch latest issue — handles two-phase pipeline (research → writing)
export async function GET(request: NextRequest) {
  const issueParam = request.nextUrl.searchParams.get("issue");
  const issueNumber = issueParam ? parseInt(issueParam) : getIssueNumber();

  if (!BLOB_TOKEN) return NextResponse.json({ status: "not_found", issueNumber });

  try {
    const { blobs } = await list({ prefix: `newsletters/issue-${issueNumber}`, token: BLOB_TOKEN });
    if (blobs.length === 0) return NextResponse.json({ status: "not_found", issueNumber });

    const res = await fetch(blobs[0].downloadUrl, { headers: { Authorization: `Bearer ${BLOB_TOKEN}` } });
    if (!res.ok) return NextResponse.json({ status: "not_found", issueNumber });

    const data = await res.json();

    // Already complete
    if (data.content) return NextResponse.json({ ...data, status: "found" });

    // Writing phase — Claude agent is working (triggered by another request)
    if (data.phase === "writing") {
      // If writing has been running for >6 min, it likely timed out — allow retry
      const writingStart = new Date(data.writingStartedAt || 0).getTime();
      if (Date.now() - writingStart < 6 * 60 * 1000) {
        return NextResponse.json({ status: "generating", issueNumber });
      }
      // Stale writing phase — fall through to re-check research
    }

    // Research phase — check if Task API deep research completed
    if (data.runId && API_KEY) {
      const statusRes = await fetch(`${BASE_URL}/v1/tasks/runs/${data.runId}`, {
        headers: { "x-api-key": API_KEY },
      });
      if (!statusRes.ok) return NextResponse.json({ status: "generating", issueNumber });

      const statusData = await statusRes.json();

      if (statusData.status === "completed") {
        // Fetch research result
        const resultRes = await fetch(`${BASE_URL}/v1/tasks/runs/${data.runId}/result`, {
          headers: { "x-api-key": API_KEY },
        });
        if (!resultRes.ok) return NextResponse.json({ status: "generating", issueNumber });

        const result = await resultRes.json();
        const rawContent = result.output?.content;
        const research = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent) || "";
        const interactionId = statusData.interaction_id || data.runId;

        if (ANTHROPIC_KEY) {
          // ─── Agent approach: Claude writes the newsletter ───
          // Mark as writing to prevent duplicate triggers
          await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify({
            ...data, phase: "writing", writingStartedAt: new Date().toISOString(),
          }), { access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN });

          try {
            // Fetch current events for regional roundup
            const events = await fetchMonitorEvents();
            const regions = new Map<string, typeof events>();
            for (const e of events) {
              if (!regions.has(e.monitorName)) regions.set(e.monitorName, []);
              regions.get(e.monitorName)!.push(e);
            }

            const bodyHtml = await writeNewsletter({
              research,
              interactionId,
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

            return NextResponse.json({ ...issueData, status: "found" });
          } catch (error) {
            console.error("[newsletter] Writing failed:", error);
            // Reset to research phase so next poll can retry
            await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify({
              ...data, phase: "research",
            }), { access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN });
            return NextResponse.json({ status: "generating", issueNumber });
          }
        } else {
          // ─── Fallback: markdown-to-HTML (no Anthropic key) ───
          const emailHtml = markdownToEmailHtml(research);
          const issueData = {
            ...data, content: research, emailHtml,
            generatedAt: new Date().toISOString(), status: "completed",
          };

          await put(`newsletters/issue-${issueNumber}.json`, JSON.stringify(issueData), {
            access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN,
          });

          return NextResponse.json({ ...issueData, status: "found" });
        }
      }

      if (statusData.status === "failed") {
        return NextResponse.json({ status: "not_found", issueNumber, error: "Research failed" });
      }

      return NextResponse.json({ status: "generating", issueNumber, runId: data.runId });
    }

    return NextResponse.json({ status: "generating", issueNumber });
  } catch {
    return NextResponse.json({ status: "not_found", issueNumber });
  }
}
