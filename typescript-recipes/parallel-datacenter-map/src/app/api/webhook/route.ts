import { NextRequest, NextResponse } from "next/server";

export interface WebhookEvent {
  monitorId: string;
  eventId: string;
  eventDate: string;
  type: string;
  content: unknown;
  receivedAt: string;
  // Snapshot-specific
  facilityIndex?: string;
  facilityName?: string;
  changedFields?: string[];
}

// In-memory stores
const recentEvents: WebhookEvent[] = [];
const MAX_EVENTS = 500;

// Track snapshot updates by facility index
const snapshotUpdates: Record<string, { timestamp: string; changedFields: string[] }> = {};

const clients = new Set<ReadableStreamDefaultController>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const metadata = body.data?.metadata || {};
    const isSnapshot = metadata.type === "datacenter-snapshot";

    // Extract changed fields from snapshot event
    const changedOutput = body.data?.event?.changed_output;
    const changedFields = changedOutput?.content
      ? Object.keys(changedOutput.content)
      : [];

    const event: WebhookEvent = {
      monitorId: body.data?.monitor_id || "",
      eventId: body.data?.event?.event_id || body.data?.event?.event_group_id || "",
      eventDate: body.data?.event?.event_date || new Date().toISOString(),
      type: body.type || "unknown",
      content: isSnapshot
        ? { changed: changedOutput?.content, previous: body.data?.event?.previous_output?.content }
        : body.data?.event?.output?.content || body.data,
      receivedAt: new Date().toISOString(),
      facilityIndex: metadata.facility_index,
      facilityName: metadata.facility_name,
      changedFields,
    };

    recentEvents.unshift(event);
    if (recentEvents.length > MAX_EVENTS) recentEvents.pop();

    // Track snapshot updates per facility
    if (isSnapshot && metadata.facility_index) {
      snapshotUpdates[metadata.facility_index] = {
        timestamp: new Date().toISOString(),
        changedFields,
      };
    }

    // Push to SSE clients
    const message = `data: ${JSON.stringify(event)}\n\n`;
    for (const controller of clients) {
      try {
        controller.enqueue(new TextEncoder().encode(message));
      } catch {
        clients.delete(controller);
      }
    }

    console.log(
      `[webhook] ${body.type} ${isSnapshot ? "SNAPSHOT" : "EVENT"} from ${event.monitorId}${
        isSnapshot ? ` facility=${metadata.facility_name} changed=[${changedFields.join(",")}]` : ""
      }`
    );

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("[webhook] Error:", e);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}

// SSE endpoint
export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      clients.add(controller);

      for (const event of recentEvents.slice(0, 10)) {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      }

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
          clients.delete(controller);
        }
      }, 30000);
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// Expose snapshot updates for the monitors API
export function getSnapshotUpdates(): Record<string, { timestamp: string; changedFields: string[] }> {
  return snapshotUpdates;
}
