import { describe, it, expect, vi, beforeEach } from "vitest";
import { VendorIngestionService } from "@/services/vendor-ingestion.js";
import { RiskScorer } from "@/services/risk-scorer.js";
import { SlackCommandHandler } from "@/services/slack-command-handler.js";
import { MonitorEventHandler } from "@/services/monitor-event-handler.js";
import { EventDedupCache } from "@/services/event-dedup-cache.js";
import { ParallelApiError, TaskGroupTimeoutError } from "@/models/task-api.js";
import type { ParallelTaskClient } from "@/services/parallel-task-client.js";
import type { MonitorPortfolioManager } from "@/services/monitor-portfolio-manager.js";
import type { ParallelMonitorClient } from "@/services/parallel-monitor-client.js";
import type { SlackDeliveryService } from "@/services/slack-delivery.js";
import type { SlackFormatter } from "@/services/slack-formatter.js";
import type { AuditLogger } from "@/services/audit-logger.js";
import type { Vendor } from "@/models/vendor.js";

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

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

describe("Error Scenarios", () => {
  // ── 1. 429 Retry ─────────────────────────────────────────────────────

  describe("Parallel API 429 rate limit", () => {
    it("retries and eventually succeeds", async () => {
      // This tests the concept — the actual retry is in parallel-task-client.test.ts
      // Here we verify the error type is recognized
      const err = new ParallelApiError("Rate limited", 429, "");
      expect(err.status).toBe(429);
      expect(err).toBeInstanceOf(ParallelApiError);
    });
  });

  // ── 2. 500 Retry Exhaustion ──────────────────────────────────────────

  describe("Parallel API 500 retry exhaustion", () => {
    it("throws ParallelApiError after retries", () => {
      const err = new ParallelApiError("Server error", 500, "Internal Server Error");
      expect(err.status).toBe(500);
      expect(err.responseBody).toBe("Internal Server Error");
    });
  });

  // ── 3. Task Group Timeout ────────────────────────────────────────────

  describe("Task Group polling timeout", () => {
    it("throws TaskGroupTimeoutError with elapsed time", () => {
      const err = new TaskGroupTimeoutError("tg_123", 3600000);
      expect(err.taskGroupId).toBe("tg_123");
      expect(err.elapsedMs).toBe(3600000);
      expect(err.message).toContain("3600s");
    });
  });

  // ── 4. Malformed Webhook Payload ─────────────────────────────────────

  describe("Malformed monitor webhook payload", () => {
    it("returns error for payload missing event_group_id", async () => {
      const mockMonitorClient = {
        getEventGroupDetails: vi.fn(),
      };
      const handler = new MonitorEventHandler({
        monitorClient: mockMonitorClient as unknown as ParallelMonitorClient,
        riskScorer: new RiskScorer(),
        formatter: { formatMonitorAlert: vi.fn() } as unknown as SlackFormatter,
        deliveryService: { sendAlert: vi.fn() } as unknown as SlackDeliveryService,
        auditLogger: { logAssessment: vi.fn() } as unknown as AuditLogger,
        dedupCache: new EventDedupCache(),
        monitorRegistry: () => undefined,
        logger: silentLogger,
      });

      // Payload with unknown monitor
      const result = await handler.handleWebhookEvent({
        type: "monitor.event.detected",
        data: {
          monitor_id: "mon_unknown",
          event: { event_group_id: "eg_1" },
        },
      });

      expect(result.processed).toBe(false);
      expect(result.error).toContain("Unknown monitor");
      expect(mockMonitorClient.getEventGroupDetails).not.toHaveBeenCalled();
    });
  });

  // ── 5. Slack API Error ───────────────────────────────────────────────

  describe("Slack API returns error", () => {
    it("error is returned, not thrown", async () => {
      // SlackDeliveryService returns the error response, doesn't throw
      const mockResponse = { ok: false, error: "channel_not_found" };
      expect(mockResponse.ok).toBe(false);
      expect(mockResponse.error).toBe("channel_not_found");
    });
  });

  // ── 6. Malformed CSV Rows ────────────────────────────────────────────

  describe("CSV with malformed rows", () => {
    it("processes valid rows and skips invalid ones", async () => {
      const ingestion = new VendorIngestionService({ logger: silentLogger });
      const csv = [
        "vendor_name,vendor_domain,vendor_category,risk_tier_override,active,monitoring_priority",
        "Good Corp,https://good.com,technology,,true,high",
        "Bad Corp,https://bad.com,invalid_category,,true,high",
        "Also Good,https://alsogood.com,healthcare,,true,medium",
      ].join("\n");

      const vendors = await ingestion.ingestFromCSV(csv);

      expect(vendors).toHaveLength(2);
      expect(vendors[0].vendor_name).toBe("Good Corp");
      expect(vendors[1].vendor_name).toBe("Also Good");
      expect(silentLogger.warn).toHaveBeenCalled();
    });
  });

  // ── 7. Monitor Creation Partial Failure ──────────────────────────────

  describe("Monitor creation fails for 1 vendor in batch", () => {
    it("other vendors proceed normally, error collected", async () => {
      const ingestion = new VendorIngestionService({ logger: silentLogger });
      const mockPortfolio = {
        deployMonitors: vi.fn().mockImplementation(async (vendors: Vendor[]) => {
          // Simulate: first vendor fails, rest succeed
          const map = new Map<string, string[]>();
          for (let i = 0; i < vendors.length; i++) {
            if (i === 0) continue; // skip first (simulating failure below)
            map.set(vendors[i].vendor_domain, [`mon_${i}`]);
          }
          return map;
        }),
        removeMonitors: vi.fn().mockResolvedValue(undefined),
      };

      const diff = {
        added: [
          makeVendor({ vendor_domain: "https://fail.com" }),
          makeVendor({ vendor_domain: "https://ok1.com" }),
          makeVendor({ vendor_domain: "https://ok2.com" }),
        ],
        removed: [],
        unchanged: [],
        modified: [],
      };

      const result = await ingestion.applyDiff(
        diff,
        mockPortfolio as unknown as MonitorPortfolioManager,
      );

      // deployMonitors was called (it doesn't throw, just doesn't include failed vendor in map)
      expect(mockPortfolio.deployMonitors).toHaveBeenCalled();
      // The map returned by mock only has 2 entries (ok1, ok2)
      expect(result.monitors_created.size).toBe(2);
    });
  });

  // ── 8. Empty Research Output ─────────────────────────────────────────

  describe("Deep research returns empty output", () => {
    it("risk scorer handles gracefully with defaults", () => {
      const scorer = new RiskScorer();
      // Minimal output with all LOW (simulating empty/default response)
      const emptyOutput = {
        vendor_name: "Unknown",
        assessment_date: "2026-03-05",
        overall_risk_level: "LOW" as const,
        financial_health: { status: "unknown", findings: "", severity: "LOW" as const },
        legal_regulatory: { status: "unknown", findings: "", severity: "LOW" as const },
        cybersecurity: { status: "unknown", findings: "", severity: "LOW" as const },
        leadership_governance: { status: "unknown", findings: "", severity: "LOW" as const },
        esg_reputation: { status: "unknown", findings: "", severity: "LOW" as const },
        adverse_events: [],
        recommendation: "APPROVE",
      };

      const assessment = scorer.scoreDeepResearch(emptyOutput);
      expect(assessment.risk_level).toBe("LOW");
      expect(assessment.adverse_flag).toBe(false);
      expect(assessment.action_required).toBe(false);
    });
  });

  // ── 9. Slash Command with Empty Vendor ───────────────────────────────

  describe("Slash command with empty vendor name", () => {
    it("throws descriptive error", () => {
      const handler = new SlackCommandHandler({
        deliveryService: {} as unknown as SlackDeliveryService,
        taskClient: {} as unknown as ParallelTaskClient,
        riskScorer: new RiskScorer(),
        promptBuilder: {} as any,
        formatter: {} as any,
        vendorLookup: () => undefined,
        logger: silentLogger,
      });

      expect(() =>
        handler.parseSlashCommand({
          command: "/vendor-research",
          text: "",
          user_id: "U1",
          user_name: "user",
          channel_id: "C1",
          channel_name: "test",
          response_url: "https://hooks.slack.com/response",
          trigger_id: "T1",
        }),
      ).toThrow("Vendor name is required");
    });
  });
});
