import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackCommandHandler } from "@/services/slack-command-handler.js";
import type { SlackDeliveryService } from "@/services/slack-delivery.js";
import type { ParallelTaskClient } from "@/services/parallel-task-client.js";
import type { RiskScorer } from "@/services/risk-scorer.js";
import type { ResearchPromptBuilder } from "@/services/research-prompt-builder.js";
import type { SlackFormatter } from "@/services/slack-formatter.js";
import type { Vendor } from "@/models/vendor.js";
import type { SlackSlashCommandPayload } from "@/models/slack-command.js";

// ── Helpers ────────────────────────────────────────────────────────────────

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

function makePayload(overrides: Partial<SlackSlashCommandPayload> = {}): SlackSlashCommandPayload {
  return {
    command: "/vendor-research",
    text: "Acme Corp",
    user_id: "U123",
    user_name: "jane.doe",
    channel_id: "C456",
    channel_name: "procurement",
    response_url: "https://hooks.slack.com/response/123",
    trigger_id: "T789",
    ...overrides,
  };
}

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

let mockDelivery: {
  sendAlert: ReturnType<typeof vi.fn>;
  sendAcknowledgment: ReturnType<typeof vi.fn>;
  sendThreadReply: ReturnType<typeof vi.fn>;
};
let mockTaskClient: { createRun: ReturnType<typeof vi.fn>; getRunResult: ReturnType<typeof vi.fn> };
let mockRiskScorer: { scoreDeepResearch: ReturnType<typeof vi.fn> };
let mockPromptBuilder: { buildPrompt: ReturnType<typeof vi.fn>; getOutputSchema: ReturnType<typeof vi.fn> };
let mockFormatter: { formatAdHocResult: ReturnType<typeof vi.fn> };
let mockVendorLookup: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  mockDelivery = {
    sendAlert: vi.fn().mockResolvedValue({ ok: true, ts: "msg_ts" }),
    sendAcknowledgment: vi.fn().mockResolvedValue("ack_ts_123"),
    sendThreadReply: vi.fn().mockResolvedValue({ ok: true, ts: "reply_ts" }),
  };

  mockTaskClient = {
    createRun: vi.fn().mockResolvedValue({ run_id: "run_abc", status: "queued" }),
    getRunResult: vi.fn().mockResolvedValue({
      output: {
        type: "json",
        content: {
          vendor_name: "Acme Corp",
          assessment_date: "2026-03-05",
          overall_risk_level: "HIGH",
          financial_health: { status: "stable", findings: "Ok", severity: "LOW" },
          legal_regulatory: { status: "issues", findings: "Lawsuit", severity: "HIGH" },
          cybersecurity: { status: "stable", findings: "Ok", severity: "LOW" },
          leadership_governance: { status: "stable", findings: "Ok", severity: "LOW" },
          esg_reputation: { status: "stable", findings: "Ok", severity: "LOW" },
          adverse_events: [],
          recommendation: "ESCALATE",
        },
      },
    }),
  };

  mockRiskScorer = {
    scoreDeepResearch: vi.fn().mockReturnValue({
      risk_level: "HIGH",
      adverse_flag: true,
      risk_categories: ["legal_regulatory"],
      summary: "High risk from litigation.",
      action_required: true,
      recommendation: "initiate_contingency",
      severity_counts: { critical: 0, high: 1, medium: 0, low: 4 },
      triggered_overrides: [],
    }),
  };

  mockPromptBuilder = {
    buildPrompt: vi.fn().mockReturnValue("Research prompt for Acme Corp"),
    getOutputSchema: vi.fn().mockReturnValue({ type: "json", json_schema: {} }),
  };

  mockFormatter = {
    formatAdHocResult: vi.fn().mockReturnValue({
      channel: "#alerts",
      text: "Ad-hoc result",
      blocks: [],
      thread_ts: "pending",
    }),
  };

  mockVendorLookup = vi.fn().mockReturnValue(makeVendor());
});

function createHandler() {
  return new SlackCommandHandler({
    deliveryService: mockDelivery as unknown as SlackDeliveryService,
    taskClient: mockTaskClient as unknown as ParallelTaskClient,
    riskScorer: mockRiskScorer as unknown as RiskScorer,
    promptBuilder: mockPromptBuilder as unknown as ResearchPromptBuilder,
    formatter: mockFormatter as unknown as SlackFormatter,
    vendorLookup: mockVendorLookup,
    logger: silentLogger,
  });
}

// ── parseSlashCommand ──────────────────────────────────────────────────────

describe("parseSlashCommand", () => {
  it("extracts vendor_name from text", () => {
    const handler = createHandler();
    const result = handler.parseSlashCommand(makePayload({ text: "Acme Corp" }));
    expect(result.vendor_name).toBe("Acme Corp");
  });

  it("trims whitespace from text", () => {
    const handler = createHandler();
    const result = handler.parseSlashCommand(makePayload({ text: "  Acme Corp  " }));
    expect(result.vendor_name).toBe("Acme Corp");
  });

  it("extracts requesting_user", () => {
    const handler = createHandler();
    const result = handler.parseSlashCommand(makePayload({ user_name: "john.smith" }));
    expect(result.requesting_user).toBe("john.smith");
  });

  it("extracts channel_id and response_url", () => {
    const handler = createHandler();
    const result = handler.parseSlashCommand(makePayload());
    expect(result.channel_id).toBe("C456");
    expect(result.response_url).toBe("https://hooks.slack.com/response/123");
  });

  it("throws on empty text", () => {
    const handler = createHandler();
    expect(() => handler.parseSlashCommand(makePayload({ text: "" }))).toThrow(
      "Vendor name is required",
    );
  });

  it("throws on whitespace-only text", () => {
    const handler = createHandler();
    expect(() => handler.parseSlashCommand(makePayload({ text: "   " }))).toThrow(
      "Vendor name is required",
    );
  });
});

// ── handleResearchCommand ──────────────────────────────────────────────────

describe("handleResearchCommand", () => {
  it("sends acknowledgment and creates task run for found vendor", async () => {
    const handler = createHandler();
    const command = handler.parseSlashCommand(makePayload());

    await handler.handleResearchCommand(command);

    expect(mockDelivery.sendAcknowledgment).toHaveBeenCalledWith("C456", "Acme Corp");
    expect(mockTaskClient.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "Research prompt for Acme Corp",
        outputSchema: { type: "json", json_schema: {} },
      }),
    );
  });

  it("stores pending request for webhook callback", async () => {
    const handler = createHandler();
    const command = handler.parseSlashCommand(makePayload());

    await handler.handleResearchCommand(command);

    expect(handler.getPendingCount()).toBe(1);
  });

  it("sends error for unknown vendor", async () => {
    mockVendorLookup.mockReturnValueOnce(undefined);
    const handler = createHandler();
    const command = handler.parseSlashCommand(makePayload({ text: "Unknown Co" }));

    await handler.handleResearchCommand(command);

    expect(mockDelivery.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C456",
        text: expect.stringContaining("Unknown Co"),
      }),
    );
    expect(mockDelivery.sendAcknowledgment).not.toHaveBeenCalled();
    expect(mockTaskClient.createRun).not.toHaveBeenCalled();
  });

  it("does not store pending for unknown vendor", async () => {
    mockVendorLookup.mockReturnValueOnce(undefined);
    const handler = createHandler();
    const command = handler.parseSlashCommand(makePayload({ text: "Unknown" }));

    await handler.handleResearchCommand(command);

    expect(handler.getPendingCount()).toBe(0);
  });
});

// ── handleWebhookCallback ──────────────────────────────────────────────────

describe("handleWebhookCallback", () => {
  it("fetches result, scores, formats, and sends thread reply", async () => {
    const handler = createHandler();
    // Set up pending request
    await handler.handleResearchCommand(handler.parseSlashCommand(makePayload()));

    await handler.handleWebhookCallback({
      run_id: "run_abc",
      status: "completed",
    });

    expect(mockTaskClient.getRunResult).toHaveBeenCalledWith("run_abc");
    expect(mockRiskScorer.scoreDeepResearch).toHaveBeenCalled();
    expect(mockFormatter.formatAdHocResult).toHaveBeenCalled();
    expect(mockDelivery.sendThreadReply).toHaveBeenCalledWith(
      "C456",
      "ack_ts_123",
      expect.objectContaining({ text: "Ad-hoc result" }),
    );
  });

  it("removes pending request after callback", async () => {
    const handler = createHandler();
    await handler.handleResearchCommand(handler.parseSlashCommand(makePayload()));
    expect(handler.getPendingCount()).toBe(1);

    await handler.handleWebhookCallback({
      run_id: "run_abc",
      status: "completed",
    });

    expect(handler.getPendingCount()).toBe(0);
  });

  it("does nothing for unknown run_id", async () => {
    const handler = createHandler();

    await handler.handleWebhookCallback({
      run_id: "run_unknown",
      status: "completed",
    });

    expect(mockTaskClient.getRunResult).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown run_id"),
      "run_unknown",
    );
  });
});
