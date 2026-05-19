import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VendorIngestionService } from "@/services/vendor-ingestion.js";
import { MonitorQueryGenerator } from "@/services/monitor-query-generator.js";
import { ResearchPromptBuilder } from "@/services/research-prompt-builder.js";
import { RiskScorer } from "@/services/risk-scorer.js";
import { SlackFormatter } from "@/services/slack-formatter.js";
import { BatchPlanner } from "@/services/batch-planner.js";
import type { Vendor } from "@/models/vendor.js";
import type { DeepResearchOutput } from "@/models/risk-assessment.js";

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fixturesDir = join(import.meta.dirname ?? __dirname, "..", "fixtures");
const sampleCsv = readFileSync(join(fixturesDir, "sample-vendors.csv"), "utf-8");
const deepResearchOutput = JSON.parse(
  readFileSync(join(fixturesDir, "deep-research-output.json"), "utf-8"),
) as DeepResearchOutput;

describe("Full Pipeline Integration", () => {
  const ingestion = new VendorIngestionService({ logger: silentLogger });
  const queryGenerator = new MonitorQueryGenerator();
  const promptBuilder = new ResearchPromptBuilder();
  const riskScorer = new RiskScorer();
  const formatter = new SlackFormatter();
  const batchPlanner = new BatchPlanner();

  let vendors: Vendor[];

  beforeEach(async () => {
    vendors = await ingestion.ingestFromCSV(sampleCsv);
  });

  it("ingests 10 vendors from CSV fixture (1 inactive)", () => {
    expect(vendors).toHaveLength(10);
    const active = vendors.filter((v) => v.active);
    expect(active).toHaveLength(9);
  });

  it("computes diff showing all as added when no previous state", () => {
    const diff = ingestion.computeDiff(vendors, []);
    expect(diff.added).toHaveLength(10);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it("generates correct monitor counts per priority", () => {
    const highVendors = vendors.filter((v) => v.monitoring_priority === "high");
    const medVendors = vendors.filter((v) => v.monitoring_priority === "medium");
    const lowVendors = vendors.filter((v) => v.monitoring_priority === "low");

    expect(highVendors).toHaveLength(3);
    expect(medVendors).toHaveLength(3);
    expect(lowVendors).toHaveLength(4);

    // high = 5 monitors each, medium = 3, low = 2
    const totalMonitors =
      highVendors.length * 5 + medVendors.length * 3 + lowVendors.length * 2;
    expect(totalMonitors).toBe(3 * 5 + 3 * 3 + 4 * 2); // 15 + 9 + 8 = 32

    // Verify via query generator
    for (const v of highVendors) {
      expect(queryGenerator.generateQueries(v)).toHaveLength(5);
    }
    for (const v of medVendors) {
      expect(queryGenerator.generateQueries(v)).toHaveLength(3);
    }
    for (const v of lowVendors) {
      expect(queryGenerator.generateQueries(v)).toHaveLength(2);
    }
  });

  it("builds prompts for each vendor", () => {
    for (const v of vendors) {
      const prompt = promptBuilder.buildPrompt(v);
      expect(prompt).toContain(v.vendor_name);
      expect(prompt).toContain(v.vendor_domain);
      expect(prompt.length).toBeGreaterThan(100);
    }
  });

  it("plans batches correctly", () => {
    const activeVendors = vendors.filter((v) => v.active);
    const batches = batchPlanner.planBatches(activeVendors, 50);
    expect(batches).toHaveLength(1); // 9 active < 50
    expect(batches[0].vendors).toHaveLength(9);
  });

  it("scores deep research output and produces valid assessment", () => {
    const assessment = riskScorer.scoreDeepResearch(deepResearchOutput);

    expect(assessment.risk_level).toBe("HIGH");
    expect(assessment.adverse_flag).toBe(true);
    expect(assessment.action_required).toBe(true);
    expect(assessment.recommendation).toBe("initiate_contingency");
    expect(assessment.severity_counts.high).toBe(1);
    expect(assessment.severity_counts.medium).toBe(1);
    expect(assessment.severity_counts.low).toBe(3);
    expect(assessment.risk_categories).toContain("financial_health");
  });

  it("formats CRITICAL/HIGH assessments as critical alerts", () => {
    const assessment = riskScorer.scoreDeepResearch(deepResearchOutput);
    const msg = formatter.formatCriticalAlert(
      assessment,
      vendors[0],
      deepResearchOutput.adverse_events,
    );

    expect(msg.channel).toBeDefined();
    expect(msg.text).toContain("Acme Corp");
    expect(msg.blocks.length).toBeGreaterThan(3);
  });

  it("routes assessments by risk level", () => {
    const lowOutput: DeepResearchOutput = {
      ...deepResearchOutput,
      financial_health: { status: "stable", findings: "ok", severity: "LOW" },
      legal_regulatory: { status: "stable", findings: "ok", severity: "LOW" },
    };
    const lowAssessment = riskScorer.scoreDeepResearch(lowOutput);
    expect(lowAssessment.risk_level).toBe("LOW");

    const channel = formatter.routeByRiskLevel(lowAssessment.risk_level);
    expect(channel).toContain("digest");
  });

  it("output schema has all required fields", () => {
    const schema = promptBuilder.getOutputSchema();
    expect(schema.type).toBe("json");
    const props = (schema.json_schema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).toHaveProperty("vendor_name");
    expect(props).toHaveProperty("financial_health");
    expect(props).toHaveProperty("adverse_events");
    expect(props).toHaveProperty("recommendation");
  });
});
