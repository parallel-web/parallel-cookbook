import { describe, it, expect } from "vitest";
import {
  MonitorSchema,
  PaginatedMonitorResponseSchema,
  MonitorEventSchema,
  MonitorEventStreamEventSchema,
  MonitorWebhookSchema,
  MonitorMetadataSchema,
  MonitorWebhookPayloadSchema,
  MonitorStatusSchema,
  MonitorTypeSchema,
  MonitorProcessorSchema,
  MonitorEventTypeSchema,
  MonitorFrequencySchema,
  legacyCadenceToFrequency,
  pickProcessor,
} from "@/models/monitor-api.js";

// ── Enums ──────────────────────────────────────────────────────────────────

describe("MonitorStatusSchema", () => {
  it("accepts active and cancelled (V1 double-l spelling)", () => {
    expect(MonitorStatusSchema.safeParse("active").success).toBe(true);
    expect(MonitorStatusSchema.safeParse("cancelled").success).toBe(true);
  });

  it("rejects the legacy single-l spelling", () => {
    expect(MonitorStatusSchema.safeParse("canceled").success).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(MonitorStatusSchema.safeParse("paused").success).toBe(false);
  });
});

describe("MonitorTypeSchema", () => {
  it("accepts event_stream and snapshot", () => {
    expect(MonitorTypeSchema.safeParse("event_stream").success).toBe(true);
    expect(MonitorTypeSchema.safeParse("snapshot").success).toBe(true);
  });

  it("rejects unknown types", () => {
    expect(MonitorTypeSchema.safeParse("event").success).toBe(false);
  });
});

describe("MonitorProcessorSchema", () => {
  it("accepts lite and base", () => {
    expect(MonitorProcessorSchema.safeParse("lite").success).toBe(true);
    expect(MonitorProcessorSchema.safeParse("base").success).toBe(true);
  });

  it("rejects task-tier processors", () => {
    expect(MonitorProcessorSchema.safeParse("ultra8x").success).toBe(false);
  });
});

describe("MonitorFrequencySchema", () => {
  it("accepts standard frequency strings", () => {
    expect(MonitorFrequencySchema.safeParse("1h").success).toBe(true);
    expect(MonitorFrequencySchema.safeParse("1d").success).toBe(true);
    expect(MonitorFrequencySchema.safeParse("7d").success).toBe(true);
    expect(MonitorFrequencySchema.safeParse("4w").success).toBe(true);
  });

  it("rejects malformed frequencies", () => {
    expect(MonitorFrequencySchema.safeParse("daily").success).toBe(false);
    expect(MonitorFrequencySchema.safeParse("1m").success).toBe(false);
  });
});

describe("MonitorEventTypeSchema", () => {
  it("accepts V1 event types", () => {
    for (const t of ["event_stream", "snapshot", "completion", "error"]) {
      expect(MonitorEventTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects the legacy 'event' literal", () => {
    expect(MonitorEventTypeSchema.safeParse("event").success).toBe(false);
  });
});

// ── MonitorSchema (V1) ────────────────────────────────────────────────────

describe("MonitorSchema", () => {
  const validMonitor = {
    monitor_id: "mon_abc123",
    type: "event_stream",
    frequency: "1d",
    processor: "lite",
    status: "active",
    settings: {
      query: "Monitor Acme Corp for regulatory changes",
      output_schema: {
        type: "json",
        json_schema: { type: "object", properties: {} },
      },
      include_backfill: false,
      advanced_settings: { location: "us" },
    },
    created_at: "2026-03-05T00:00:00Z",
  };

  it("accepts a minimal valid V1 monitor", () => {
    const result = MonitorSchema.safeParse(validMonitor);
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated V1 monitor with webhook + metadata", () => {
    const result = MonitorSchema.safeParse({
      ...validMonitor,
      webhook: {
        url: "https://example.com/hook",
        event_types: ["monitor.event.detected"],
      },
      metadata: {
        vendor_name: "Acme Corp",
        vendor_domain: "https://acme.com",
        monitor_category: "regulatory",
        risk_dimension: "compliance",
      },
      last_run_at: "2026-03-05T06:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null last_run_at", () => {
    const result = MonitorSchema.safeParse({ ...validMonitor, last_run_at: null });
    expect(result.success).toBe(true);
  });

  it("passes through extra fields", () => {
    const result = MonitorSchema.parse({
      ...validMonitor,
      some_future_field: "value",
    });
    expect((result as Record<string, unknown>).some_future_field).toBe("value");
  });

  it("rejects missing monitor_id", () => {
    const { monitor_id, ...rest } = validMonitor;
    expect(MonitorSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing type discriminant", () => {
    const { type, ...rest } = validMonitor;
    expect(MonitorSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(
      MonitorSchema.safeParse({ ...validMonitor, status: "paused" }).success,
    ).toBe(false);
  });

  it("rejects the legacy single-l 'canceled'", () => {
    expect(
      MonitorSchema.safeParse({ ...validMonitor, status: "canceled" }).success,
    ).toBe(false);
  });
});

// ── PaginatedMonitorResponseSchema ─────────────────────────────────────────

describe("PaginatedMonitorResponseSchema", () => {
  const monitor = {
    monitor_id: "m1",
    type: "event_stream",
    frequency: "1d",
    processor: "lite",
    status: "active",
    settings: { query: "q1" },
    created_at: "2026-03-05T00:00:00Z",
  };

  it("accepts a response with monitors", () => {
    const result = PaginatedMonitorResponseSchema.safeParse({
      monitors: [monitor],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty monitors array", () => {
    const result = PaginatedMonitorResponseSchema.safeParse({ monitors: [] });
    expect(result.success).toBe(true);
  });

  it("accepts next_cursor", () => {
    const result = PaginatedMonitorResponseSchema.safeParse({
      monitors: [monitor],
      next_cursor: "opaque",
    });
    expect(result.success).toBe(true);
  });
});

// ── MonitorWebhookSchema ───────────────────────────────────────────────────

describe("MonitorWebhookSchema", () => {
  it("accepts valid webhook", () => {
    const result = MonitorWebhookSchema.safeParse({
      url: "https://example.com/hook",
      event_types: ["monitor.event.detected"],
    });
    expect(result.success).toBe(true);
  });

  it("defaults event_types to monitor.event.detected", () => {
    const result = MonitorWebhookSchema.parse({
      url: "https://example.com/hook",
    });
    expect(result.event_types).toEqual(["monitor.event.detected"]);
  });

  it("accepts the V1 execution event types", () => {
    const result = MonitorWebhookSchema.safeParse({
      url: "https://example.com/hook",
      event_types: ["monitor.execution.completed", "monitor.execution.failed"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL", () => {
    expect(
      MonitorWebhookSchema.safeParse({ url: "not-a-url" }).success,
    ).toBe(false);
  });
});

// ── MonitorMetadataSchema ──────────────────────────────────────────────────

describe("MonitorMetadataSchema", () => {
  it("accepts valid PRD metadata (string values)", () => {
    const result = MonitorMetadataSchema.safeParse({
      vendor_name: "Acme Corp",
      vendor_domain: "https://acme.com",
      monitor_category: "regulatory",
      risk_dimension: "compliance",
    });
    expect(result.success).toBe(true);
  });

  it("allows additional string properties (V1 metadata is string-only)", () => {
    const result = MonitorMetadataSchema.parse({
      vendor_name: "Acme",
      vendor_domain: "https://acme.com",
      monitor_category: "financial",
      risk_dimension: "credit",
      custom_field: "extra_value",
    });
    expect(result.custom_field).toBe("extra_value");
  });

  it("rejects missing required fields", () => {
    expect(
      MonitorMetadataSchema.safeParse({ vendor_name: "Acme" }).success,
    ).toBe(false);
  });
});

// ── MonitorEventSchema (V1 union: event_stream | snapshot | completion | error) ──

describe("MonitorEventSchema", () => {
  it("accepts an event_stream event with typed output + basis", () => {
    const result = MonitorEventStreamEventSchema.safeParse({
      event_id: "evt_001",
      event_group_id: "eg_001",
      event_date: "2026-03-05",
      output: {
        type: "json",
        content: {
          event_summary: "Federal court rules against Acme Corp",
          severity: "HIGH",
          adverse: true,
          event_type: "legal_regulatory",
        },
        basis: [
          {
            field: "event_summary",
            reasoning: "Court ruling cited",
            citations: [
              {
                url: "https://reuters.com/legal/acme-ruling",
                title: "Acme loses patent case",
              },
            ],
            confidence: "high",
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a snapshot diff event via the union", () => {
    const result = MonitorEventSchema.safeParse({
      event_type: "snapshot",
      event_id: "evt_snap_001",
      event_group_id: "eg_snap",
      event_date: "2026-03-05",
      changed_output: { type: "json", content: {}, basis: [] },
      previous_output: { type: "json", content: {}, basis: [] },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a completion event with no output", () => {
    const result = MonitorEventSchema.safeParse({
      event_type: "completion",
      timestamp: "2026-03-05T06:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an error event with error_message", () => {
    const result = MonitorEventSchema.safeParse({
      event_type: "error",
      timestamp: "2026-03-05T06:00:00Z",
      error_message: "Quota exceeded",
    });
    expect(result.success).toBe(true);
  });
});

// ── MonitorWebhookPayloadSchema ────────────────────────────────────────────

describe("MonitorWebhookPayloadSchema", () => {
  it("accepts a valid V1 inbound webhook payload", () => {
    const result = MonitorWebhookPayloadSchema.safeParse({
      type: "monitor.event.detected",
      data: {
        monitor_id: "mon_123",
        event: { event_group_id: "eg_456" },
        metadata: {
          vendor_name: "Acme Corp",
          vendor_domain: "https://acme.com",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts payload without metadata", () => {
    const result = MonitorWebhookPayloadSchema.safeParse({
      type: "monitor.event.detected",
      data: {
        monitor_id: "mon_123",
        event: { event_group_id: "eg_456" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing data.monitor_id", () => {
    expect(
      MonitorWebhookPayloadSchema.safeParse({
        type: "monitor.event.detected",
        data: { event: { event_group_id: "eg_456" } },
      }).success,
    ).toBe(false);
  });

  it("rejects missing data.event.event_group_id", () => {
    expect(
      MonitorWebhookPayloadSchema.safeParse({
        type: "monitor.event.detected",
        data: { monitor_id: "mon_123", event: {} },
      }).success,
    ).toBe(false);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

describe("legacyCadenceToFrequency", () => {
  it("maps daily to 1d and weekly to 7d", () => {
    expect(legacyCadenceToFrequency("daily")).toBe("1d");
    expect(legacyCadenceToFrequency("weekly")).toBe("7d");
  });
});

describe("pickProcessor", () => {
  it("picks base for high-priority cyber and legal", () => {
    expect(pickProcessor("cyber", "high")).toBe("base");
    expect(pickProcessor("legal", "high")).toBe("base");
  });

  it("falls back to lite for everything else", () => {
    expect(pickProcessor("cyber", "medium")).toBe("lite");
    expect(pickProcessor("financial", "high")).toBe("lite");
    expect(pickProcessor("esg", "low")).toBe("lite");
  });
});
