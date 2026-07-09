import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { ParallelMonitorClient } from "@/lib/parallel/monitor-client";
import { verifyToken } from "@/lib/server/webhook-token";
import { getActiveIntegration, markIntegrationUsed } from "@/lib/server/integrations";
import { notifyAssessment } from "@/lib/server/notifications";
import { normalizeSeverity } from "@/lib/parallel/severity";

export const runtime = "nodejs";
export const maxDuration = 60;

interface MonitorWebhookPayload {
  type?: string;
  data?: {
    monitor_id?: string;
    event?: { event_group_id?: string };
    metadata?: Record<string, unknown>;
  };
}

interface MonitorEventOutput {
  event_summary?: string;
  severity?: string;
  adverse?: boolean;
  event_type?: string;
}

// normalizeSeverity now lives in @/lib/parallel/severity so the route, the
// risk scorer, and the src-side scorer all share one off-enum collapse
// rule (finding 11).

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  if (!(await verifyToken("monitor", token))) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let payload: MonitorWebhookPayload;
  try {
    payload = (await request.json()) as MonitorWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const monitorId = payload.data?.monitor_id;
  const eventGroupId = payload.data?.event?.event_group_id;
  if (!monitorId || !eventGroupId) {
    return NextResponse.json({ error: "Missing monitor_id or event_group_id" }, { status: 400 });
  }

  const { data: monitorRow } = await db()
    .from("monitors")
    .select("id, account_id, vendor_id, dimension")
    .eq("parallel_monitor_id", monitorId)
    .maybeSingle();

  if (!monitorRow) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const integration = await getActiveIntegration(monitorRow.account_id, "parallel");
  if (!integration) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  await markIntegrationUsed(monitorRow.account_id, integration.id);

  const client = new ParallelMonitorClient({
    apiKey: integration.secret,
    baseUrl: env().PARALLEL_BASE_URL,
  });

  // V1: unified /events endpoint filtered by `event_group_id` replaces
  // the alpha `/event_groups/{id}` GET. Returns at most one event_stream
  // event per execution (plus optional completion/error events).
  let page;
  try {
    page = await client.listEvents(monitorId, {
      event_group_id: eventGroupId,
      include_completions: false,
    });
  } catch (err) {
    console.error("[webhook/monitor] failed to fetch monitor events", err);
    return NextResponse.json({ ok: true, error: "fetch_failed" });
  }

  const events = Array.isArray(page?.events) ? page.events : [];
  const inserted: string[] = [];

  for (const evt of events) {
    const e = evt as unknown as Record<string, unknown>;
    // V1 event_stream events always carry a stable `event_id`. Snapshot
    // and completion events are skipped via the type guard below.
    if (e.event_type && e.event_type !== "event_stream") continue;
    const eventId =
      (e.event_id as string | undefined) ??
      `${monitorId}:${eventGroupId}:${(e.event_date as string | undefined) ?? Date.now()}`;

    // V1: `output` is always a typed object `{ type, content, basis }`
    // — never a top-level string anymore. Content holds our flat
    // monitor schema (`event_summary`, `severity`, `adverse`,
    // `event_type`); basis carries per-field citations.
    const rawOutput = e.output as
      | { type?: string; content?: unknown; basis?: Array<{ citations?: Array<{ url?: string }> }> }
      | undefined;
    const content =
      rawOutput && typeof rawOutput.content === "object" && rawOutput.content !== null
        ? (rawOutput.content as MonitorEventOutput)
        : ({} as MonitorEventOutput);

    // Pull the first available citation URL out of basis to keep our
    // existing `source_url` column populated for the dashboard's links.
    const firstCitation = (rawOutput?.basis ?? [])
      .flatMap((entry) => entry.citations ?? [])
      .find((c) => typeof c.url === "string")?.url;

    const detail = content.event_summary ?? "";
    const title = detail.slice(0, 140);
    const severity = normalizeSeverity(content.severity);

    const { error: insertErr } = await db().from("monitor_events").upsert(
      {
        account_id: monitorRow.account_id,
        vendor_id: monitorRow.vendor_id,
        monitor_id: monitorRow.id,
        parallel_event_id: eventId,
        parallel_event_group_id: eventGroupId,
        parallel_monitor_id: monitorId,
        severity,
        dimension: monitorRow.dimension,
        title: title || "Monitor event",
        detail: detail || null,
        source_url: firstCitation ?? null,
        raw_payload: evt as object,
      },
      { onConflict: "parallel_event_id" },
    );
    if (insertErr) {
      console.error("[webhook/monitor] failed to insert event", insertErr);
      continue;
    }
    inserted.push(eventId);
  }

  await db()
    .from("monitors")
    .update({ last_event_at: new Date().toISOString() })
    .eq("id", monitorRow.id);

  // Fan an alert out to Slack + email for any HIGH or CRITICAL events.
  // V1 events nest the procurement-flat shape under `output.content`.
  const severeEvents = events.filter((evt) => {
    const out = (evt as { output?: { content?: MonitorEventOutput } }).output ?? {};
    const sev = normalizeSeverity(out.content?.severity);
    return sev === "HIGH" || sev === "CRITICAL";
  });
  if (severeEvents.length > 0) {
    const { data: vendor } = await db()
      .from("vendors")
      .select("vendor_name, vendor_domain")
      .eq("id", monitorRow.vendor_id)
      .maybeSingle();
    const top = severeEvents[0] as { output?: { content?: MonitorEventOutput } };
    const content = top.output?.content ?? {};
    await notifyAssessment({
      accountId: monitorRow.account_id,
      vendorName: vendor?.vendor_name ?? "Unknown vendor",
      vendorDomain: vendor?.vendor_domain ?? null,
      riskLevel: normalizeSeverity(content.severity),
      summary: content.event_summary ?? "Monitor flagged a new event",
      source: "monitor_event",
      url: `${env().APP_URL}/feed`,
    });
  }

  return NextResponse.json({ ok: true, inserted: inserted.length });
}
