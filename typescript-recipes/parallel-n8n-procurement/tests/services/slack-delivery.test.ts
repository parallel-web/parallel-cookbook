import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { SlackDeliveryService } from "@/services/slack-delivery.js";
import type { SlackFormatter } from "@/services/slack-formatter.js";
import type { SlackMessage } from "@/models/slack.js";
import type { RiskAssessment } from "@/models/risk-assessment.js";
import type { Vendor } from "@/models/vendor.js";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
  },
}));

const mockPost = vi.mocked(axios.post);

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeMessage(overrides: Partial<SlackMessage> = {}): SlackMessage {
  return {
    channel: "#test",
    text: "Test message",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    risk_level: "MEDIUM",
    adverse_flag: false,
    risk_categories: ["financial_health"],
    summary: "Moderate risk.",
    action_required: false,
    recommendation: "escalate_review",
    severity_counts: { critical: 0, high: 0, medium: 1, low: 4 },
    triggered_overrides: [],
    ...overrides,
  };
}

function makeVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    vendor_name: "Acme Corp",
    vendor_domain: "https://acme.com",
    vendor_category: "technology",
    monitoring_priority: "high",
    active: true,
    ...overrides,
  };
}

const mockFormatter = {
  formatDailyDigest: vi.fn().mockReturnValue(makeMessage({ channel: "#digest" })),
  routeByRiskLevel: vi.fn().mockReturnValue("#test"),
} as unknown as SlackFormatter;

function createService() {
  return new SlackDeliveryService({
    webhookUrl: "https://hooks.slack.com/test",
    formatter: mockFormatter,
    logger: silentLogger,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPost.mockResolvedValue({ data: { ok: true, ts: "1234567890.123456" } });
});

// ── sendAlert ──────────────────────────────────────────────────────────────

describe("sendAlert", () => {
  it("sends POST with correct body", async () => {
    const service = createService();
    const msg = makeMessage({ channel: "#alerts", text: "Alert!" });

    await service.sendAlert(msg);

    expect(mockPost).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({
        channel: "#alerts",
        text: "Alert!",
        blocks: msg.blocks,
      }),
    );
  });

  it("returns ts from response", async () => {
    const service = createService();
    mockPost.mockResolvedValueOnce({ data: { ok: true, ts: "ts_123" } });

    const result = await service.sendAlert(makeMessage());
    expect(result.ts).toBe("ts_123");
  });

  it("handles string 'ok' response from webhook", async () => {
    const service = createService();
    mockPost.mockResolvedValueOnce({ data: "ok" });

    const result = await service.sendAlert(makeMessage());
    expect(result.ok).toBe(true);
  });

  it("returns error from Slack", async () => {
    const service = createService();
    mockPost.mockResolvedValueOnce({
      data: { ok: false, error: "channel_not_found" },
    });

    const result = await service.sendAlert(makeMessage());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("channel_not_found");
  });
});

// ── sendThreadReply ────────────────────────────────────────────────────────

describe("sendThreadReply", () => {
  it("sets thread_ts in payload", async () => {
    const service = createService();

    await service.sendThreadReply("#channel", "ts_parent", makeMessage());

    expect(mockPost).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({
        thread_ts: "ts_parent",
        channel: "#channel",
      }),
    );
  });
});

// ── sendAcknowledgment ─────────────────────────────────────────────────────

describe("sendAcknowledgment", () => {
  it("sends message with vendor name", async () => {
    const service = createService();
    mockPost.mockResolvedValueOnce({ data: { ok: true, ts: "ack_ts" } });

    const ts = await service.sendAcknowledgment("#channel", "TestCo");

    expect(mockPost).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({
        channel: "#channel",
      }),
    );
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.text).toContain("TestCo");
  });

  it("returns ts for threading", async () => {
    const service = createService();
    mockPost.mockResolvedValueOnce({ data: { ok: true, ts: "ack_ts_123" } });

    const ts = await service.sendAcknowledgment("#channel", "TestCo");
    expect(ts).toBe("ack_ts_123");
  });

  it("returns empty string when no ts in response", async () => {
    const service = createService();
    mockPost.mockResolvedValueOnce({ data: "ok" });

    const ts = await service.sendAcknowledgment("#channel", "TestCo");
    expect(ts).toBe("");
  });
});

// ── Digest Queue ───────────────────────────────────────────────────────────

describe("digest queue", () => {
  it("starts empty", () => {
    const service = createService();
    expect(service.getDigestQueueSize()).toBe(0);
  });

  it("queueForDigest adds to queue", () => {
    const service = createService();
    service.queueForDigest(makeAssessment(), makeVendor());
    expect(service.getDigestQueueSize()).toBe(1);
  });

  it("accumulates multiple items", () => {
    const service = createService();
    service.queueForDigest(makeAssessment(), makeVendor({ vendor_name: "A" }));
    service.queueForDigest(makeAssessment(), makeVendor({ vendor_name: "B" }));
    service.queueForDigest(makeAssessment(), makeVendor({ vendor_name: "C" }));
    expect(service.getDigestQueueSize()).toBe(3);
  });

  it("flushDigest with items formats and sends digest", async () => {
    const service = createService();
    service.queueForDigest(makeAssessment(), makeVendor());
    service.queueForDigest(makeAssessment(), makeVendor());

    const result = await service.flushDigest();

    expect(mockFormatter.formatDailyDigest).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ risk_level: "MEDIUM" })]),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
  });

  it("flushDigest clears the queue", async () => {
    const service = createService();
    service.queueForDigest(makeAssessment(), makeVendor());

    await service.flushDigest();
    expect(service.getDigestQueueSize()).toBe(0);
  });

  it("flushDigest with empty queue returns null", async () => {
    const service = createService();
    const result = await service.flushDigest();

    expect(result).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

// ── Rate Limiting ──────────────────────────────────────────────────────────

describe("rate limiting", () => {
  it("serializes multiple rapid sends", async () => {
    vi.useFakeTimers();
    const service = createService();
    const callOrder: number[] = [];

    mockPost.mockImplementation(async () => {
      callOrder.push(callOrder.length + 1);
      return { data: { ok: true, ts: "ts" } };
    });

    const p1 = service.sendAlert(makeMessage({ text: "first" }));
    const p2 = service.sendAlert(makeMessage({ text: "second" }));
    const p3 = service.sendAlert(makeMessage({ text: "third" }));

    // First send happens immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(callOrder).toEqual([1]);

    // After 1s delay, second fires
    await vi.advanceTimersByTimeAsync(1000);
    expect(callOrder).toEqual([1, 2]);

    // After another 1s, third fires
    await vi.advanceTimersByTimeAsync(1000);
    expect(callOrder).toEqual([1, 2, 3]);

    await Promise.all([p1, p2, p3]);
    vi.useRealTimers();
  });
});
