import { describe, it, expect, vi, beforeEach } from "vitest";
import { MonitorEventHandler } from "@/services/monitor-event-handler.js";
import { EventDedupCache } from "@/services/event-dedup-cache.js";
import type { ParallelMonitorClient } from "@/services/parallel-monitor-client.js";
import type { RiskScorer } from "@/services/risk-scorer.js";
import type { SlackFormatter } from "@/services/slack-formatter.js";
import type { SlackDeliveryService } from "@/services/slack-delivery.js";
import type { AuditLogger } from "@/services/audit-logger.js";
import type {
  MonitorWebhookPayload,
  PaginatedMonitorEvents,
} from "@/models/monitor-api.js";
import type { MonitorRegistryContext } from "@/models/monitor-events.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makePayload(overrides: Partial<MonitorWebhookPayload> = {}): MonitorWebhookPayload {
  return {
    type: "monitor.event.detected",
    data: {
      monitor_id: "mon_1",
      event: { event_group_id: "eg_1" },
      metadata: { vendor_name: "Acme Corp" },
    },
    ...overrides,
  };
}

// V1 events: typed `output` carrying `content` + `basis`. Includes a
// completion event in the page to verify the handler skips non-event-stream
// entries.
function makeEventsPage(): PaginatedMonitorEvents {
  return {
    events: [
      {
        event_id: "evt_1",
        event_group_id: "eg_1",
        event_date: "2026-03-05",
        event_type: "event_stream",
        output: {
          type: "json",
          content: {
            event_summary: "Regulatory fine imposed on vendor",
            severity: "HIGH",
            adverse: true,
            event_type: "legal_regulatory",
          },
          basis: [
            {
              field: "event_summary",
              reasoning: "Cited by Reuters and Bloomberg",
              citations: [
                { url: "https://news.example.com/article", title: "Acme fined" },
              ],
              confidence: "high",
            },
          ],
        },
      },
      {
        event_type: "completion",
        timestamp: "2026-03-05T06:00:00Z",
      },
    ],
    next_cursor: null,
  };
}

const defaultContext: MonitorRegistryContext = {
  vendor_name: "Acme Corp",
  vendor_domain: "https://acme.com",
  risk_dimension: "legal",
  monitoring_priority: "high",
  monitor_category: "Legal & Regulatory",
};

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockMonitorClient: { listEvents: ReturnType<typeof vi.fn> };
let mockRiskScorer: { scoreMonitorEvent: ReturnType<typeof vi.fn> };
let mockFormatter: { formatMonitorAlert: ReturnType<typeof vi.fn> };
let mockDelivery: { sendAlert: ReturnType<typeof vi.fn> };
let mockAuditLogger: { logAssessment: ReturnType<typeof vi.fn> };
let mockRegistry: ReturnType<typeof vi.fn>;
let dedupCache: EventDedupCache;

beforeEach(() => {
  vi.clearAllMocks();

  mockMonitorClient = {
    listEvents: vi.fn().mockResolvedValue(makeEventsPage()),
  };

  mockRiskScorer = {
    scoreMonitorEvent: vi.fn().mockReturnValue({
      risk_level: "HIGH",
      adverse_flag: true,
      risk_categories: ["legal_regulatory"],
      summary: "High risk from regulatory fine.",
      action_required: true,
      recommendation: "initiate_contingency",
      severity_counts: { critical: 0, high: 1, medium: 0, low: 0 },
      triggered_overrides: [],
      top_citations: [
        {
          dimension: "legal_regulatory",
          url: "https://news.example.com/article",
          title: "Acme fined",
          confidence: "high",
        },
      ],
    }),
  };

  mockFormatter = {
    formatMonitorAlert: vi.fn().mockReturnValue({
      channel: "#alerts",
      text: "Monitor alert",
      blocks: [],
    }),
  };

  mockDelivery = {
    sendAlert: vi.fn().mockResolvedValue({ ok: true }),
  };

  mockAuditLogger = {
    logAssessment: vi.fn().mockResolvedValue(undefined),
  };

  mockRegistry = vi.fn().mockReturnValue(defaultContext);
  dedupCache = new EventDedupCache(60_000);
});

function createHandler() {
  return new MonitorEventHandler({
    monitorClient: mockMonitorClient as unknown as ParallelMonitorClient,
    riskScorer: mockRiskScorer as unknown as RiskScorer,
    formatter: mockFormatter as unknown as SlackFormatter,
    deliveryService: mockDelivery as unknown as SlackDeliveryService,
    auditLogger: mockAuditLogger as unknown as AuditLogger,
    dedupCache,
    monitorRegistry: mockRegistry,
    logger: silentLogger,
  });
}

// ── handleWebhookEvent ─────────────────────────────────────────────────────

describe("handleWebhookEvent", () => {
  it("processes valid V1 payload end-to-end", async () => {
    const handler = createHandler();
    const result = await handler.handleWebhookEvent(makePayload());

    expect(result.processed).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.vendor_domain).toBe("https://acme.com");
    expect(result.event_group_id).toBe("eg_1");
    expect(result.assessment).toBeDefined();
    expect(result.assessment!.risk_level).toBe("HIGH");

    expect(mockMonitorClient.listEvents).toHaveBeenCalledWith("mon_1", {
      event_group_id: "eg_1",
      include_completions: false,
    });
    expect(mockRiskScorer.scoreMonitorEvent).toHaveBeenCalled();
    // Third arg is the basis array forwarded from output.basis.
    const scoreArgs = mockRiskScorer.scoreMonitorEvent.mock.calls[0];
    expect(scoreArgs[2]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "event_summary" }),
      ]),
    );

    expect(mockFormatter.formatMonitorAlert).toHaveBeenCalled();
    expect(mockDelivery.sendAlert).toHaveBeenCalled();
    expect(mockAuditLogger.logAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "monitor_event",
        top_citation_url: "https://news.example.com/article",
        top_citation_title: "Acme fined",
        confidence: "high",
      }),
    );
  });

  it("returns error for unknown monitor_id", async () => {
    mockRegistry.mockReturnValueOnce(undefined);
    const handler = createHandler();

    const result = await handler.handleWebhookEvent(makePayload());

    expect(result.processed).toBe(false);
    expect(result.error).toContain("Unknown monitor");
    expect(mockMonitorClient.listEvents).not.toHaveBeenCalled();
    expect(mockDelivery.sendAlert).not.toHaveBeenCalled();
  });

  it("returns duplicate=true for same event within window", async () => {
    const handler = createHandler();

    const first = await handler.handleWebhookEvent(makePayload());
    expect(first.processed).toBe(true);

    const second = await handler.handleWebhookEvent(makePayload());
    expect(second.processed).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(mockDelivery.sendAlert).toHaveBeenCalledTimes(1);
  });

  it("processes different event_type as unique", async () => {
    const handler = createHandler();

    await handler.handleWebhookEvent(makePayload());

    const differentPage: PaginatedMonitorEvents = {
      events: [
        {
          event_id: "evt_3",
          event_group_id: "eg_2",
          event_date: "2026-03-05",
          event_type: "event_stream",
          output: {
            type: "json",
            content: {
              event_summary: "Data breach",
              severity: "CRITICAL",
              adverse: true,
              event_type: "cybersecurity",
            },
            basis: [],
          },
        },
      ],
      next_cursor: null,
    };
    mockMonitorClient.listEvents.mockResolvedValueOnce(differentPage);

    const result = await handler.handleWebhookEvent(
      makePayload({
        data: {
          monitor_id: "mon_2",
          event: { event_group_id: "eg_2" },
        },
      }),
    );

    expect(result.processed).toBe(true);
    expect(result.duplicate).toBe(false);
  });
});

// ── enrichEvent ────────────────────────────────────────────────────────────

describe("enrichEvent", () => {
  it("merges vendor context with V1 event data", () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent(
      "mon_1",
      makeEventsPage().events,
      defaultContext,
    );

    expect(enriched).toBeDefined();
    expect(enriched!.vendor_name).toBe("Acme Corp");
    expect(enriched!.vendor_domain).toBe("https://acme.com");
    expect(enriched!.risk_dimension).toBe("legal");
    expect(enriched!.monitor_category).toBe("Legal & Regulatory");
    expect(enriched!.event_group_id).toBe("eg_1");
    expect(enriched!.monitor_id).toBe("mon_1");
  });

  it("parses structured output.content from V1 events", () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent(
      "mon_1",
      makeEventsPage().events,
      defaultContext,
    );

    expect(enriched!.event_summary).toBe("Regulatory fine imposed on vendor");
    expect(enriched!.severity).toBe("HIGH");
    expect(enriched!.adverse).toBe(true);
    expect(enriched!.event_type).toBe("legal_regulatory");
    expect(enriched!.basis).toHaveLength(1);
  });

  it("skips completion events and uses the event_stream entry", () => {
    const handler = createHandler();
    const events: PaginatedMonitorEvents["events"] = [
      { event_type: "completion", timestamp: "2026-03-05T06:00:00Z" },
      {
        event_id: "evt_1",
        event_group_id: "eg_1",
        event_date: "2026-03-05",
        event_type: "event_stream",
        output: {
          type: "json",
          content: {
            event_summary: "Finding",
            severity: "MEDIUM",
            adverse: false,
            event_type: "financial",
          },
          basis: [],
        },
      },
    ];

    const enriched = handler.enrichEvent("mon_1", events, defaultContext);

    expect(enriched!.event_id).toBe("evt_1");
    expect(enriched!.event_summary).toBe("Finding");
  });

  it("falls back to text content when output.type === text", () => {
    const handler = createHandler();
    const events: PaginatedMonitorEvents["events"] = [
      {
        event_id: "evt_1",
        event_group_id: "eg_1",
        event_date: "2026-03-05",
        event_type: "event_stream",
        output: {
          type: "text",
          content: "Plain text finding",
          basis: [],
        },
      },
    ];

    const enriched = handler.enrichEvent("mon_1", events, defaultContext);

    expect(enriched!.event_summary).toBe("Plain text finding");
    expect(enriched!.severity).toBe("LOW"); // default
  });

  it("returns undefined when no event_stream entries are present", () => {
    const handler = createHandler();
    const events: PaginatedMonitorEvents["events"] = [
      { event_type: "completion", timestamp: "2026-03-05T06:00:00Z" },
    ];

    const enriched = handler.enrichEvent("mon_1", events, defaultContext);

    expect(enriched).toBeUndefined();
  });
});

// ── isDuplicate ────────────────────────────────────────────────────────────

describe("isDuplicate", () => {
  it("returns false for first event", () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent(
      "mon_1",
      makeEventsPage().events,
      defaultContext,
    );

    expect(handler.isDuplicate(enriched!)).toBe(false);
  });

  it("returns true after event is recorded", async () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent(
      "mon_1",
      makeEventsPage().events,
      defaultContext,
    );
    const assessment = mockRiskScorer.scoreMonitorEvent();

    await handler.recordEvent(enriched!, assessment);

    expect(handler.isDuplicate(enriched!)).toBe(true);
  });
});

// ── recordEvent ────────────────────────────────────────────────────────────

describe("recordEvent", () => {
  it("adds to dedup cache", async () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent(
      "mon_1",
      makeEventsPage().events,
      defaultContext,
    );
    const assessment = mockRiskScorer.scoreMonitorEvent();

    await handler.recordEvent(enriched!, assessment);

    expect(dedupCache.size).toBe(1);
  });

  it("logs to audit logger with V1 top_citation fields", async () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent(
      "mon_1",
      makeEventsPage().events,
      defaultContext,
    );
    const assessment = mockRiskScorer.scoreMonitorEvent();

    await handler.recordEvent(enriched!, assessment);

    expect(mockAuditLogger.logAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_name: "Acme Corp",
        source: "monitor_event",
        run_id: "eg_1",
        top_citation_url: "https://news.example.com/article",
        top_citation_title: "Acme fined",
        confidence: "high",
      }),
    );
  });
});
