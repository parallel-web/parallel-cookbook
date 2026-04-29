import { describe, it, expect, vi, beforeEach } from "vitest";
import { MonitorEventHandler } from "@/services/monitor-event-handler.js";
import { EventDedupCache } from "@/services/event-dedup-cache.js";
import type { ParallelMonitorClient } from "@/services/parallel-monitor-client.js";
import type { RiskScorer } from "@/services/risk-scorer.js";
import type { SlackFormatter } from "@/services/slack-formatter.js";
import type { SlackDeliveryService } from "@/services/slack-delivery.js";
import type { AuditLogger } from "@/services/audit-logger.js";
import type { MonitorWebhookPayload, EventGroupDetails } from "@/models/monitor-api.js";
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

function makeEventDetails(): EventGroupDetails {
  return {
    event_group_id: "eg_1",
    monitor_id: "mon_1",
    events: [
      {
        type: "event",
        event_id: "evt_1",
        event_group_id: "eg_1",
        monitor_id: "mon_1",
        event_date: "2026-03-05",
        output: {
          event_summary: "Regulatory fine imposed on vendor",
          severity: "HIGH",
          adverse: true,
          event_type: "legal_regulatory",
        },
        source_urls: ["https://news.example.com/article"],
      },
      {
        type: "completion",
        event_id: "evt_2",
        monitor_id: "mon_1",
      },
    ],
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

let mockMonitorClient: { getEventGroupDetails: ReturnType<typeof vi.fn> };
let mockRiskScorer: { scoreMonitorEvent: ReturnType<typeof vi.fn> };
let mockFormatter: { formatMonitorAlert: ReturnType<typeof vi.fn> };
let mockDelivery: { sendAlert: ReturnType<typeof vi.fn> };
let mockAuditLogger: { logAssessment: ReturnType<typeof vi.fn> };
let mockRegistry: ReturnType<typeof vi.fn>;
let dedupCache: EventDedupCache;

beforeEach(() => {
  vi.clearAllMocks();

  mockMonitorClient = {
    getEventGroupDetails: vi.fn().mockResolvedValue(makeEventDetails()),
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
  dedupCache = new EventDedupCache(60_000); // 1 minute for tests
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
  it("processes valid payload end-to-end", async () => {
    const handler = createHandler();
    const result = await handler.handleWebhookEvent(makePayload());

    expect(result.processed).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.vendor_domain).toBe("https://acme.com");
    expect(result.event_group_id).toBe("eg_1");
    expect(result.assessment).toBeDefined();
    expect(result.assessment!.risk_level).toBe("HIGH");

    expect(mockMonitorClient.getEventGroupDetails).toHaveBeenCalledWith("mon_1", "eg_1");
    expect(mockRiskScorer.scoreMonitorEvent).toHaveBeenCalled();
    expect(mockFormatter.formatMonitorAlert).toHaveBeenCalled();
    expect(mockDelivery.sendAlert).toHaveBeenCalled();
    expect(mockAuditLogger.logAssessment).toHaveBeenCalledWith(
      expect.objectContaining({ source: "monitor_event" }),
    );
  });

  it("returns error for unknown monitor_id", async () => {
    mockRegistry.mockReturnValueOnce(undefined);
    const handler = createHandler();

    const result = await handler.handleWebhookEvent(makePayload());

    expect(result.processed).toBe(false);
    expect(result.error).toContain("Unknown monitor");
    expect(mockMonitorClient.getEventGroupDetails).not.toHaveBeenCalled();
    expect(mockDelivery.sendAlert).not.toHaveBeenCalled();
  });

  it("returns duplicate=true for same event within window", async () => {
    const handler = createHandler();

    // First call — processed
    const first = await handler.handleWebhookEvent(makePayload());
    expect(first.processed).toBe(true);

    // Second call — duplicate
    const second = await handler.handleWebhookEvent(makePayload());
    expect(second.processed).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(mockDelivery.sendAlert).toHaveBeenCalledTimes(1); // only first
  });

  it("processes different event_type as unique", async () => {
    const handler = createHandler();

    // First event
    await handler.handleWebhookEvent(makePayload());

    // Second event with different output
    const differentDetails: EventGroupDetails = {
      ...makeEventDetails(),
      events: [
        {
          type: "event",
          event_id: "evt_3",
          output: {
            event_summary: "Data breach",
            severity: "CRITICAL",
            adverse: true,
            event_type: "cybersecurity",
          },
        },
      ],
    };
    mockMonitorClient.getEventGroupDetails.mockResolvedValueOnce(differentDetails);

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
  it("merges vendor context with event data", () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent("mon_1", makeEventDetails(), defaultContext);

    expect(enriched.vendor_name).toBe("Acme Corp");
    expect(enriched.vendor_domain).toBe("https://acme.com");
    expect(enriched.risk_dimension).toBe("legal");
    expect(enriched.monitor_category).toBe("Legal & Regulatory");
    expect(enriched.event_group_id).toBe("eg_1");
    expect(enriched.monitor_id).toBe("mon_1");
  });

  it("parses structured output", () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent("mon_1", makeEventDetails(), defaultContext);

    expect(enriched.event_summary).toBe("Regulatory fine imposed on vendor");
    expect(enriched.severity).toBe("HIGH");
    expect(enriched.adverse).toBe(true);
    expect(enriched.event_type).toBe("legal_regulatory");
  });

  it("skips completion events and uses event type", () => {
    const handler = createHandler();
    const details: EventGroupDetails = {
      event_group_id: "eg_1",
      monitor_id: "mon_1",
      events: [
        { type: "completion", event_id: "evt_c" },
        {
          type: "event",
          event_id: "evt_1",
          output: {
            event_summary: "Finding",
            severity: "MEDIUM",
            adverse: false,
            event_type: "financial",
          },
        },
      ],
    };

    const enriched = handler.enrichEvent("mon_1", details, defaultContext);

    expect(enriched.event_id).toBe("evt_1");
    expect(enriched.event_summary).toBe("Finding");
  });

  it("handles string output", () => {
    const handler = createHandler();
    const details: EventGroupDetails = {
      event_group_id: "eg_1",
      monitor_id: "mon_1",
      events: [
        { type: "event", event_id: "evt_1", output: "Plain text finding" },
      ],
    };

    const enriched = handler.enrichEvent("mon_1", details, defaultContext);

    expect(enriched.event_summary).toBe("Plain text finding");
    expect(enriched.severity).toBe("LOW"); // default
  });

  it("handles no event entries gracefully", () => {
    const handler = createHandler();
    const details: EventGroupDetails = {
      event_group_id: "eg_1",
      monitor_id: "mon_1",
      events: [{ type: "completion", event_id: "evt_c" }],
    };

    const enriched = handler.enrichEvent("mon_1", details, defaultContext);

    expect(enriched.event_summary).toBe("");
    expect(enriched.severity).toBe("LOW");
  });
});

// ── isDuplicate ────────────────────────────────────────────────────────────

describe("isDuplicate", () => {
  it("returns false for first event", () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent("mon_1", makeEventDetails(), defaultContext);

    expect(handler.isDuplicate(enriched)).toBe(false);
  });

  it("returns true after event is recorded", async () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent("mon_1", makeEventDetails(), defaultContext);
    const assessment = mockRiskScorer.scoreMonitorEvent();

    await handler.recordEvent(enriched, assessment);

    expect(handler.isDuplicate(enriched)).toBe(true);
  });
});

// ── recordEvent ────────────────────────────────────────────────────────────

describe("recordEvent", () => {
  it("adds to dedup cache", async () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent("mon_1", makeEventDetails(), defaultContext);
    const assessment = mockRiskScorer.scoreMonitorEvent();

    await handler.recordEvent(enriched, assessment);

    expect(dedupCache.size).toBe(1);
  });

  it("logs to audit logger", async () => {
    const handler = createHandler();
    const enriched = handler.enrichEvent("mon_1", makeEventDetails(), defaultContext);
    const assessment = mockRiskScorer.scoreMonitorEvent();

    await handler.recordEvent(enriched, assessment);

    expect(mockAuditLogger.logAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_name: "Acme Corp",
        source: "monitor_event",
        run_id: "eg_1",
      }),
    );
  });
});
