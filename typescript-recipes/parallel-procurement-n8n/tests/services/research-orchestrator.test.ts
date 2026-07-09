import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResearchOrchestrator } from "@/services/research-orchestrator.js";
import { BatchPlanner } from "@/services/batch-planner.js";
import type { ParallelTaskClient } from "@/services/parallel-task-client.js";
import type { ResearchPromptBuilder } from "@/services/research-prompt-builder.js";
import type { RiskScorer } from "@/services/risk-scorer.js";
import type { SlackFormatter } from "@/services/slack-formatter.js";
import type { SlackDeliveryService } from "@/services/slack-delivery.js";
import type { AuditLogger } from "@/services/audit-logger.js";
import type { Vendor } from "@/models/vendor.js";
import type { DeepResearchOutput, RiskAssessment } from "@/models/risk-assessment.js";
import type { SlackOpsReporter } from "@/services/slack-ops-reporter.js";

// ── Helpers ────────────────────────────────────────────────────────────────

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

function makeResearchOutput(vendorName = "Acme Corp"): DeepResearchOutput {
  const dim = (sev = "LOW") => ({ status: "stable", findings: "Ok", severity: sev });
  return {
    vendor_name: vendorName,
    assessment_date: "2026-03-05",
    overall_risk_level: "LOW",
    financial_health: dim(),
    legal_regulatory: dim(),
    cybersecurity: dim(),
    leadership_governance: dim(),
    esg_reputation: dim(),
    adverse_events: [],
    recommendation: "APPROVE",
  } as DeepResearchOutput;
}

function makeAssessment(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    risk_level: "LOW",
    adverse_flag: false,
    risk_categories: [],
    summary: "All clear.",
    action_required: false,
    recommendation: "continue_monitoring",
    severity_counts: { critical: 0, high: 0, medium: 0, low: 5 },
    triggered_overrides: [],
    ...overrides,
  };
}

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockTaskClient: {
  createTaskGroup: ReturnType<typeof vi.fn>;
  addRunsToGroup: ReturnType<typeof vi.fn>;
  pollTaskGroupUntilComplete: ReturnType<typeof vi.fn>;
};
let mockPromptBuilder: { buildPrompt: ReturnType<typeof vi.fn>; getOutputSchema: ReturnType<typeof vi.fn> };
let mockRiskScorer: { scoreDeepResearch: ReturnType<typeof vi.fn> };
let mockFormatter: { formatCriticalAlert: ReturnType<typeof vi.fn> };
let mockDelivery: {
  sendAlert: ReturnType<typeof vi.fn>;
  queueForDigest: ReturnType<typeof vi.fn>;
};
let mockAuditLogger: { logAssessment: ReturnType<typeof vi.fn> };
let mockOpsReporter: { sendRunSummary: ReturnType<typeof vi.fn> };
let batchPlanner: BatchPlanner;

beforeEach(() => {
  vi.clearAllMocks();

  mockTaskClient = {
    createTaskGroup: vi.fn().mockResolvedValue({ taskgroup_id: "tg_1" }),
    addRunsToGroup: vi.fn().mockResolvedValue(["run_1"]),
    pollTaskGroupUntilComplete: vi.fn().mockResolvedValue([
      {
        run_id: "run_1",
        status: "completed",
        output: { type: "json", content: makeResearchOutput() },
      },
    ]),
  };

  mockPromptBuilder = {
    buildPrompt: vi.fn().mockReturnValue("Research prompt"),
    getOutputSchema: vi.fn().mockReturnValue({ type: "json", json_schema: {} }),
  };

  mockRiskScorer = {
    scoreDeepResearch: vi.fn().mockReturnValue(makeAssessment()),
  };

  mockFormatter = {
    formatCriticalAlert: vi.fn().mockReturnValue({
      channel: "#alerts",
      text: "Alert",
      blocks: [],
    }),
  };

  mockDelivery = {
    sendAlert: vi.fn().mockResolvedValue({ ok: true }),
    queueForDigest: vi.fn(),
  };

  mockAuditLogger = {
    logAssessment: vi.fn().mockResolvedValue(undefined),
  };

  mockOpsReporter = {
    sendRunSummary: vi.fn().mockResolvedValue(undefined),
  };

  batchPlanner = new BatchPlanner();
});

function createOrchestrator() {
  return new ResearchOrchestrator({
    taskClient: mockTaskClient as unknown as ParallelTaskClient,
    batchPlanner,
    promptBuilder: mockPromptBuilder as unknown as ResearchPromptBuilder,
    riskScorer: mockRiskScorer as unknown as RiskScorer,
    formatter: mockFormatter as unknown as SlackFormatter,
    deliveryService: mockDelivery as unknown as SlackDeliveryService,
    auditLogger: mockAuditLogger as unknown as AuditLogger,
    cycleLength: 7,
    pollIntervalMs: 100,
    pollTimeoutMs: 5000,
    logger: silentLogger,
  });
}

// ── runScheduledResearch ───────────────────────────────────────────────────

describe("runScheduledResearch", () => {
  it("returns zero summary when no vendors are due", async () => {
    const orchestrator = createOrchestrator();
    // All vendors have future dates
    const vendors = [
      makeVendor({ next_research_date: "2099-01-01T00:00:00.000Z" }),
    ];

    const summary = await orchestrator.runScheduledResearch(vendors);

    expect(summary.total_due).toBe(0);
    expect(summary.total_researched).toBe(0);
    expect(summary.batches_executed).toBe(0);
    expect(mockTaskClient.createTaskGroup).not.toHaveBeenCalled();
  });

  it("processes due vendors and returns correct summary", async () => {
    const orchestrator = createOrchestrator();
    const vendors = [
      makeVendor({ vendor_domain: "https://a.com", vendor_name: "A" }),
    ];

    mockTaskClient.pollTaskGroupUntilComplete.mockResolvedValueOnce([
      {
        run_id: "run_1",
        status: "completed",
        output: { type: "json", content: makeResearchOutput("A") },
      },
    ]);

    const summary = await orchestrator.runScheduledResearch(vendors);

    expect(summary.total_due).toBe(1);
    expect(summary.total_researched).toBe(1);
    expect(summary.total_failed).toBe(0);
    expect(summary.batches_executed).toBe(1);
    expect(summary.risk_counts.LOW).toBe(1);
    expect(summary.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("handles multiple vendors across batches", async () => {
    const orchestrator = createOrchestrator();
    const vendors = Array.from({ length: 3 }, (_, i) =>
      makeVendor({ vendor_domain: `https://v${i}.com`, vendor_name: `V${i}` }),
    );

    mockTaskClient.addRunsToGroup.mockResolvedValue(["r0", "r1", "r2"]);
    mockTaskClient.pollTaskGroupUntilComplete.mockResolvedValue(
      vendors.map((v, i) => ({
        run_id: `r${i}`,
        status: "completed",
        output: { type: "json", content: makeResearchOutput(v.vendor_name) },
      })),
    );

    const summary = await orchestrator.runScheduledResearch(vendors);

    expect(summary.total_due).toBe(3);
    expect(summary.total_researched).toBe(3);
  });
});

// ── executeBatch ───────────────────────────────────────────────────────────

describe("executeBatch", () => {
  it("creates task group, adds runs, polls, returns results", async () => {
    const orchestrator = createOrchestrator();
    const batch = { batch_index: 0, vendors: [makeVendor()] };

    const result = await orchestrator.executeBatch(batch);

    expect(mockTaskClient.createTaskGroup).toHaveBeenCalled();
    expect(mockTaskClient.addRunsToGroup).toHaveBeenCalledWith(
      "tg_1",
      [{ input: "Research prompt" }],
      expect.objectContaining({ output_schema: expect.anything() }),
    );
    expect(mockTaskClient.pollTaskGroupUntilComplete).toHaveBeenCalledWith(
      "tg_1",
      100,
      5000,
    );
    expect(result.results.size).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it("captures failed runs in failures array", async () => {
    const orchestrator = createOrchestrator();
    const batch = {
      batch_index: 0,
      vendors: [
        makeVendor({ vendor_domain: "https://good.com" }),
        makeVendor({ vendor_domain: "https://bad.com" }),
      ],
    };

    mockTaskClient.addRunsToGroup.mockResolvedValueOnce(["run_good", "run_bad"]);
    mockTaskClient.pollTaskGroupUntilComplete.mockResolvedValueOnce([
      {
        run_id: "run_good",
        status: "completed",
        output: { type: "json", content: makeResearchOutput() },
      },
      {
        run_id: "run_bad",
        status: "failed",
        error: "Timeout",
      },
    ]);

    const result = await orchestrator.executeBatch(batch);

    expect(result.results.size).toBe(1);
    expect(result.results.has("https://good.com")).toBe(true);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].vendor_domain).toBe("https://bad.com");
    expect(result.failures[0].error).toBe("Timeout");
  });

  it("all vendors fail → no results, only failures", async () => {
    const orchestrator = createOrchestrator();
    const batch = {
      batch_index: 0,
      vendors: [makeVendor({ vendor_domain: "https://fail.com" })],
    };

    mockTaskClient.addRunsToGroup.mockResolvedValueOnce(["run_fail"]);
    mockTaskClient.pollTaskGroupUntilComplete.mockResolvedValueOnce([
      { run_id: "run_fail", status: "failed", error: "Error" },
    ]);

    const result = await orchestrator.executeBatch(batch);

    expect(result.results.size).toBe(0);
    expect(result.failures).toHaveLength(1);
  });
});

// ── processResults ─────────────────────────────────────────────────────────

describe("processResults", () => {
  it("CRITICAL assessment → sendAlert called", async () => {
    mockRiskScorer.scoreDeepResearch.mockReturnValueOnce(
      makeAssessment({ risk_level: "CRITICAL", adverse_flag: true }),
    );

    const orchestrator = createOrchestrator();
    const results = new Map([["https://acme.com", makeResearchOutput()]]);
    const vendors = [makeVendor()];

    await orchestrator.processResults(results, vendors);

    expect(mockDelivery.sendAlert).toHaveBeenCalled();
    expect(mockDelivery.queueForDigest).not.toHaveBeenCalled();
  });

  it("HIGH assessment → sendAlert called", async () => {
    mockRiskScorer.scoreDeepResearch.mockReturnValueOnce(
      makeAssessment({ risk_level: "HIGH" }),
    );

    const orchestrator = createOrchestrator();
    await orchestrator.processResults(
      new Map([["https://acme.com", makeResearchOutput()]]),
      [makeVendor()],
    );

    expect(mockDelivery.sendAlert).toHaveBeenCalled();
  });

  it("MEDIUM assessment → queueForDigest called", async () => {
    mockRiskScorer.scoreDeepResearch.mockReturnValueOnce(
      makeAssessment({ risk_level: "MEDIUM" }),
    );

    const orchestrator = createOrchestrator();
    await orchestrator.processResults(
      new Map([["https://acme.com", makeResearchOutput()]]),
      [makeVendor()],
    );

    expect(mockDelivery.queueForDigest).toHaveBeenCalled();
    expect(mockDelivery.sendAlert).not.toHaveBeenCalled();
  });

  it("LOW assessment → no Slack call", async () => {
    mockRiskScorer.scoreDeepResearch.mockReturnValueOnce(
      makeAssessment({ risk_level: "LOW" }),
    );

    const orchestrator = createOrchestrator();
    await orchestrator.processResults(
      new Map([["https://acme.com", makeResearchOutput()]]),
      [makeVendor()],
    );

    expect(mockDelivery.sendAlert).not.toHaveBeenCalled();
    expect(mockDelivery.queueForDigest).not.toHaveBeenCalled();
  });

  it("audit logger called for each result", async () => {
    const orchestrator = createOrchestrator();
    const results = new Map([
      ["https://a.com", makeResearchOutput("A")],
      ["https://b.com", makeResearchOutput("B")],
    ]);
    const vendors = [
      makeVendor({ vendor_domain: "https://a.com", vendor_name: "A" }),
      makeVendor({ vendor_domain: "https://b.com", vendor_name: "B" }),
    ];

    await orchestrator.processResults(results, vendors);

    expect(mockAuditLogger.logAssessment).toHaveBeenCalledTimes(2);
    expect(mockAuditLogger.logAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_name: "A",
        source: "deep_research",
      }),
    );
  });

  it("returns errors for vendors not in input list", async () => {
    const orchestrator = createOrchestrator();
    const results = new Map([
      ["https://unknown.com", makeResearchOutput()],
    ]);

    const processed = await orchestrator.processResults(results, []);

    expect(processed.errors).toHaveLength(1);
    expect(processed.errors[0].vendor_domain).toBe("https://unknown.com");
  });
});

// ── handlePartialFailure ───────────────────────────────────────────────────

describe("handlePartialFailure", () => {
  it("logs warning for each failed vendor", async () => {
    const orchestrator = createOrchestrator();
    const batch = { batch_index: 0, vendors: [makeVendor()] };

    await orchestrator.handlePartialFailure(batch, ["https://fail.com"]);

    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      "https://fail.com",
      expect.anything(),
    );
  });
});

// ── Integration: failed vendors don't advance dates ────────────────────────

describe("date advancement", () => {
  it("failed vendors do not get advanced dates", async () => {
    const orchestrator = createOrchestrator();
    const updateSpy = vi.spyOn(batchPlanner, "updateNextResearchDates");

    const vendors = [
      makeVendor({ vendor_domain: "https://good.com", vendor_name: "Good" }),
      makeVendor({ vendor_domain: "https://bad.com", vendor_name: "Bad" }),
    ];

    mockTaskClient.addRunsToGroup.mockResolvedValueOnce(["run_good", "run_bad"]);
    mockTaskClient.pollTaskGroupUntilComplete.mockResolvedValueOnce([
      {
        run_id: "run_good",
        status: "completed",
        output: { type: "json", content: makeResearchOutput("Good") },
      },
      {
        run_id: "run_bad",
        status: "failed",
        error: "Timeout",
      },
    ]);

    await orchestrator.runScheduledResearch(vendors);

    expect(updateSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ vendor_domain: "https://good.com" }),
      ]),
      7,
    );
    // The failed vendor should NOT be in the array
    const updatedVendors = updateSpy.mock.calls[0][0];
    expect(updatedVendors.find((v: Vendor) => v.vendor_domain === "https://bad.com")).toBeUndefined();
  });
});

// ── ops reporting on failure ────────────────────────────────────────────────

function createOrchestratorWithOps() {
  return new ResearchOrchestrator({
    taskClient: mockTaskClient as unknown as ParallelTaskClient,
    batchPlanner,
    promptBuilder: mockPromptBuilder as unknown as ResearchPromptBuilder,
    riskScorer: mockRiskScorer as unknown as RiskScorer,
    formatter: mockFormatter as unknown as SlackFormatter,
    deliveryService: mockDelivery as unknown as SlackDeliveryService,
    auditLogger: mockAuditLogger as unknown as AuditLogger,
    opsReporter: mockOpsReporter as unknown as SlackOpsReporter,
    cycleLength: 7,
    pollIntervalMs: 100,
    pollTimeoutMs: 5000,
    logger: silentLogger,
  });
}

describe("ops reporting", () => {
  it("sends run summary when there are failures", async () => {
    const orchestrator = createOrchestratorWithOps();
    const vendors = [
      makeVendor({ vendor_domain: "https://fail.com", vendor_name: "Fail" }),
    ];

    mockTaskClient.addRunsToGroup.mockResolvedValueOnce(["run_fail"]);
    mockTaskClient.pollTaskGroupUntilComplete.mockResolvedValueOnce([
      { run_id: "run_fail", status: "failed", error: "Timeout" },
    ]);

    await orchestrator.runScheduledResearch(vendors);

    expect(mockOpsReporter.sendRunSummary).toHaveBeenCalledWith(
      expect.objectContaining({ total_failed: 1 }),
    );
  });

  it("sends run summary when there are adverse findings", async () => {
    const orchestrator = createOrchestratorWithOps();
    const vendors = [makeVendor()];

    mockRiskScorer.scoreDeepResearch.mockReturnValueOnce(
      makeAssessment({ risk_level: "CRITICAL", adverse_flag: true }),
    );

    await orchestrator.runScheduledResearch(vendors);

    expect(mockOpsReporter.sendRunSummary).toHaveBeenCalledWith(
      expect.objectContaining({ adverse_count: 1 }),
    );
  });

  it("does NOT send run summary when everything is clean", async () => {
    const orchestrator = createOrchestratorWithOps();
    const vendors = [makeVendor()];

    await orchestrator.runScheduledResearch(vendors);

    expect(mockOpsReporter.sendRunSummary).not.toHaveBeenCalled();
  });

  it("does not throw if opsReporter.sendRunSummary fails", async () => {
    mockOpsReporter.sendRunSummary.mockRejectedValueOnce(new Error("Slack down"));
    const orchestrator = createOrchestratorWithOps();
    const vendors = [
      makeVendor({ vendor_domain: "https://fail.com", vendor_name: "Fail" }),
    ];

    mockTaskClient.addRunsToGroup.mockResolvedValueOnce(["run_fail"]);
    mockTaskClient.pollTaskGroupUntilComplete.mockResolvedValueOnce([
      { run_id: "run_fail", status: "failed", error: "Timeout" },
    ]);

    const summary = await orchestrator.runScheduledResearch(vendors);

    expect(summary.total_failed).toBe(1);
    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send ops run summary"),
      "Slack down",
    );
  });

  it("works without opsReporter (backward compatible)", async () => {
    const orchestrator = createOrchestrator(); // no opsReporter
    const vendors = [
      makeVendor({ vendor_domain: "https://fail.com", vendor_name: "Fail" }),
    ];

    mockTaskClient.addRunsToGroup.mockResolvedValueOnce(["run_fail"]);
    mockTaskClient.pollTaskGroupUntilComplete.mockResolvedValueOnce([
      { run_id: "run_fail", status: "failed", error: "Timeout" },
    ]);

    const summary = await orchestrator.runScheduledResearch(vendors);

    expect(summary.total_failed).toBe(1);
    // Should not throw even though no opsReporter
  });
});
