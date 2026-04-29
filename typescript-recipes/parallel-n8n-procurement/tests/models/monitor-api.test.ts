import { describe, it, expect } from "vitest";
import {
  MonitorSchema,
  MonitorListResponseSchema,
  MonitorEventSchema,
  MonitorWebhookSchema,
  MonitorMetadataSchema,
  MonitorOutputSchemaDefinition,
  MonitorWebhookPayloadSchema,
  EventGroupDetailsSchema,
  MonitorCadenceSchema,
  MonitorStatusSchema,
  MonitorEventTypeSchema,
} from "@/models/monitor-api.js";

// ── Enums ──────────────────────────────────────────────────────────────────

describe("MonitorCadenceSchema", () => {
  it("accepts daily and weekly", () => {
    expect(MonitorCadenceSchema.safeParse("daily").success).toBe(true);
    expect(MonitorCadenceSchema.safeParse("weekly").success).toBe(true);
  });

  it("rejects invalid cadence", () => {
    expect(MonitorCadenceSchema.safeParse("hourly").success).toBe(false);
    expect(MonitorCadenceSchema.safeParse("monthly").success).toBe(false);
  });
});

describe("MonitorStatusSchema", () => {
  it("accepts active and canceled", () => {
    expect(MonitorStatusSchema.safeParse("active").success).toBe(true);
    expect(MonitorStatusSchema.safeParse("canceled").success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(MonitorStatusSchema.safeParse("paused").success).toBe(false);
  });
});

describe("MonitorEventTypeSchema", () => {
  it("accepts all event types", () => {
    for (const t of ["event", "error", "completion"]) {
      expect(MonitorEventTypeSchema.safeParse(t).success).toBe(true);
    }
  });
});

// ── MonitorSchema ──────────────────────────────────────────────────────────

describe("MonitorSchema", () => {
  const validMonitor = {
    monitor_id: "mon_abc123",
    query: "Monitor Acme Corp for regulatory changes",
    status: "active",
    cadence: "daily",
  };

  it("accepts a minimal valid monitor", () => {
    const result = MonitorSchema.safeParse(validMonitor);
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated monitor", () => {
    const result = MonitorSchema.safeParse({
      ...validMonitor,
      metadata: {
        vendor_name: "Acme Corp",
        vendor_domain: "https://acme.com",
        monitor_category: "regulatory",
        risk_dimension: "compliance",
      },
      webhook: { url: "https://example.com/hook", event_types: ["monitor.event.detected"] },
      output_schema: { type: "json", json_schema: {} },
      created_at: "2026-03-05T00:00:00Z",
      last_run_at: "2026-03-05T06:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts webhook as a plain string", () => {
    const result = MonitorSchema.safeParse({
      ...validMonitor,
      webhook: "https://example.com/hook",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null webhook and last_run_at", () => {
    const result = MonitorSchema.safeParse({
      ...validMonitor,
      webhook: null,
      last_run_at: null,
    });
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

  it("rejects missing query", () => {
    const { query, ...rest } = validMonitor;
    expect(MonitorSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(
      MonitorSchema.safeParse({ ...validMonitor, status: "paused" }).success,
    ).toBe(false);
  });
});

// ── MonitorListResponseSchema ──────────────────────────────────────────────

describe("MonitorListResponseSchema", () => {
  it("accepts a response with monitors", () => {
    const result = MonitorListResponseSchema.safeParse({
      monitors: [
        { monitor_id: "m1", query: "q1", status: "active", cadence: "daily" },
      ],
      total_count: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty monitors array", () => {
    const result = MonitorListResponseSchema.safeParse({
      monitors: [],
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

  it("defaults event_types", () => {
    const result = MonitorWebhookSchema.parse({
      url: "https://example.com/hook",
    });
    expect(result.event_types).toEqual(["monitor.event.detected"]);
  });

  it("rejects invalid URL", () => {
    expect(
      MonitorWebhookSchema.safeParse({ url: "not-a-url" }).success,
    ).toBe(false);
  });
});

// ── MonitorMetadataSchema ──────────────────────────────────────────────────

describe("MonitorMetadataSchema", () => {
  it("accepts valid PRD metadata", () => {
    const result = MonitorMetadataSchema.safeParse({
      vendor_name: "Acme Corp",
      vendor_domain: "https://acme.com",
      monitor_category: "regulatory",
      risk_dimension: "compliance",
    });
    expect(result.success).toBe(true);
  });

  it("allows additional properties", () => {
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

// ── MonitorOutputSchemaDefinition ──────────────────────────────────────────

describe("MonitorOutputSchemaDefinition", () => {
  it("accepts valid PRD Section 5.3 output", () => {
    const result = MonitorOutputSchemaDefinition.safeParse({
      event_summary: "Regulatory fine imposed on vendor",
      severity: "HIGH",
      adverse: true,
      event_type: "regulatory_action",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing event_summary", () => {
    expect(
      MonitorOutputSchemaDefinition.safeParse({
        severity: "LOW",
        adverse: false,
        event_type: "news",
      }).success,
    ).toBe(false);
  });

  it("rejects non-boolean adverse", () => {
    expect(
      MonitorOutputSchemaDefinition.safeParse({
        event_summary: "test",
        severity: "LOW",
        adverse: "yes",
        event_type: "news",
      }).success,
    ).toBe(false);
  });
});

// ── MonitorEventSchema ─────────────────────────────────────────────────────

describe("MonitorEventSchema", () => {
  it("accepts an event type", () => {
    const result = MonitorEventSchema.safeParse({
      type: "event",
      event_id: "evt_123",
      event_group_id: "eg_456",
      monitor_id: "mon_789",
      event_date: "2026-03-05",
      output: "Vendor announced layoffs",
      source_urls: ["https://news.example.com/article"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an error type", () => {
    const result = MonitorEventSchema.safeParse({
      type: "error",
      event_id: "evt_123",
      error: "Failed to process",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a completion type", () => {
    const result = MonitorEventSchema.safeParse({
      type: "completion",
      event_id: "evt_123",
      monitor_id: "mon_789",
    });
    expect(result.success).toBe(true);
  });

  it("accepts output as object", () => {
    const result = MonitorEventSchema.safeParse({
      type: "event",
      output: { event_summary: "Layoffs announced", severity: "HIGH" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid type", () => {
    expect(
      MonitorEventSchema.safeParse({ type: "unknown" }).success,
    ).toBe(false);
  });
});

// ── EventGroupDetailsSchema ────────────────────────────────────────────────

describe("EventGroupDetailsSchema", () => {
  it("accepts valid event group details", () => {
    const result = EventGroupDetailsSchema.safeParse({
      event_group_id: "eg_123",
      monitor_id: "mon_456",
      events: [
        { type: "event", event_id: "evt_1", output: "Some finding" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts with metadata", () => {
    const result = EventGroupDetailsSchema.safeParse({
      event_group_id: "eg_123",
      monitor_id: "mon_456",
      events: [],
      metadata: { vendor_name: "Acme" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing event_group_id", () => {
    expect(
      EventGroupDetailsSchema.safeParse({
        monitor_id: "mon_456",
        events: [],
      }).success,
    ).toBe(false);
  });
});

// ── MonitorWebhookPayloadSchema ────────────────────────────────────────────

describe("MonitorWebhookPayloadSchema", () => {
  it("accepts a valid inbound webhook payload", () => {
    const result = MonitorWebhookPayloadSchema.safeParse({
      type: "monitor.event.detected",
      data: {
        monitor_id: "mon_123",
        event: {
          event_group_id: "eg_456",
          output: "Adverse finding",
          source_urls: ["https://example.com"],
        },
        metadata: {
          vendor_name: "Acme Corp",
          vendor_domain: "https://acme.com",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts without metadata", () => {
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
        data: {
          event: { event_group_id: "eg_456" },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects missing data.event.event_group_id", () => {
    expect(
      MonitorWebhookPayloadSchema.safeParse({
        type: "monitor.event.detected",
        data: {
          monitor_id: "mon_123",
          event: {},
        },
      }).success,
    ).toBe(false);
  });
});
