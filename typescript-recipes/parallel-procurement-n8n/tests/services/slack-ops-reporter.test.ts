import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackOpsReporter } from "@/services/slack-ops-reporter.js";
import type { SlackDeliveryService } from "@/services/slack-delivery.js";
import type { HealthCheckReport } from "@/models/health-check.js";
import type { ResearchRunSummary } from "@/models/research-run.js";

let mockDelivery: { sendAlert: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockDelivery = { sendAlert: vi.fn().mockResolvedValue({ ok: true }) };
});

function makeReport(overrides: Partial<HealthCheckReport> = {}): HealthCheckReport {
  return {
    timestamp: "2026-03-05T12:00:00.000Z",
    total_monitors: 25,
    active_count: 22,
    failed_count: 2,
    orphan_count: 1,
    orphans_deleted: 1,
    monitors_recreated: 2,
    webhook_healthy: true,
    errors: [],
    ...overrides,
  };
}

describe("SlackOpsReporter", () => {
  it("sends report to ops channel", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
      opsChannel: "#test-ops",
    });

    await reporter.sendHealthReport(makeReport());

    expect(mockDelivery.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "#test-ops" }),
    );
  });

  it("uses default ops channel", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendHealthReport(makeReport());

    expect(mockDelivery.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "#vendor-risk-ops" }),
    );
  });

  it("includes wrench emoji and date in header", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendHealthReport(makeReport());

    const msg = mockDelivery.sendAlert.mock.calls[0][0];
    const headerBlock = msg.blocks[0];
    expect(headerBlock.text.text).toContain("\ud83d\udd27");
    expect(headerBlock.text.text).toContain("2026-03-05");
  });

  it("includes correct counts in body", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendHealthReport(makeReport());

    const blocksText = JSON.stringify(mockDelivery.sendAlert.mock.calls[0][0].blocks);
    expect(blocksText).toContain("25"); // total
    expect(blocksText).toContain("22"); // active
    expect(blocksText).toContain("2");  // failed + recreated
    expect(blocksText).toContain("1");  // orphan
  });

  it("shows webhook healthy status", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendHealthReport(makeReport({ webhook_healthy: true }));
    let text = JSON.stringify(mockDelivery.sendAlert.mock.calls[0][0].blocks);
    expect(text).toContain("Reachable");

    await reporter.sendHealthReport(makeReport({ webhook_healthy: false }));
    text = JSON.stringify(mockDelivery.sendAlert.mock.calls[1][0].blocks);
    expect(text).toContain("UNREACHABLE");
  });

  it("includes errors when present", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendHealthReport(
      makeReport({ errors: ["Failed to delete mon_1", "API timeout"] }),
    );

    const blocksText = JSON.stringify(mockDelivery.sendAlert.mock.calls[0][0].blocks);
    expect(blocksText).toContain("Failed to delete mon_1");
    expect(blocksText).toContain("API timeout");
    expect(blocksText).toContain("Errors (2)");
  });

  it("has non-empty text fallback", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendHealthReport(makeReport());

    const msg = mockDelivery.sendAlert.mock.calls[0][0];
    expect(msg.text.length).toBeGreaterThan(0);
  });
});

// ── sendRunSummary ──────────────────────────────────────────────────────────

function makeRunSummary(overrides: Partial<ResearchRunSummary> = {}): ResearchRunSummary {
  return {
    total_due: 10,
    total_researched: 8,
    total_failed: 2,
    risk_counts: { LOW: 4, MEDIUM: 2, HIGH: 1, CRITICAL: 1 },
    adverse_count: 1,
    batches_executed: 2,
    duration_ms: 45000,
    ...overrides,
  };
}

describe("sendRunSummary", () => {
  it("sends run summary to ops channel", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
      opsChannel: "#test-ops",
    });

    await reporter.sendRunSummary(makeRunSummary());

    expect(mockDelivery.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "#test-ops" }),
    );
  });

  it("includes failure count in body", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendRunSummary(makeRunSummary({ total_failed: 3 }));

    const blocksText = JSON.stringify(mockDelivery.sendAlert.mock.calls[0][0].blocks);
    expect(blocksText).toContain("3");
  });

  it("includes adverse count in body", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendRunSummary(makeRunSummary({ adverse_count: 2 }));

    const blocksText = JSON.stringify(mockDelivery.sendAlert.mock.calls[0][0].blocks);
    expect(blocksText).toContain("2");
  });

  it("includes risk breakdown in context", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendRunSummary(makeRunSummary());

    const blocksText = JSON.stringify(mockDelivery.sendAlert.mock.calls[0][0].blocks);
    expect(blocksText).toContain("CRITICAL: 1");
    expect(blocksText).toContain("HIGH: 1");
    expect(blocksText).toContain("MEDIUM: 2");
    expect(blocksText).toContain("LOW: 4");
  });

  it("shows warning icon when failures present", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendRunSummary(makeRunSummary({ total_failed: 1 }));

    const header = mockDelivery.sendAlert.mock.calls[0][0].blocks[0];
    expect(header.text.text).toContain("\u26a0\ufe0f");
  });

  it("shows check icon when no failures", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendRunSummary(makeRunSummary({ total_failed: 0 }));

    const header = mockDelivery.sendAlert.mock.calls[0][0].blocks[0];
    expect(header.text.text).toContain("\u2705");
  });

  it("has non-empty text fallback", async () => {
    const reporter = new SlackOpsReporter({
      deliveryService: mockDelivery as unknown as SlackDeliveryService,
    });

    await reporter.sendRunSummary(makeRunSummary());

    const msg = mockDelivery.sendAlert.mock.calls[0][0];
    expect(msg.text.length).toBeGreaterThan(0);
    expect(msg.text).toContain("Research Run Complete");
  });
});
