import { describe, it, expect } from "vitest";
import {
  DeepResearchOutputSchema,
  MonitorEventOutputSchema,
  RiskAssessmentSchema,
  SeverityCountsSchema,
} from "@/models/risk-assessment.js";

const makeDimension = (severity = "LOW") => ({
  status: severity === "LOW" ? "stable" : "issues",
  findings: "Test findings",
  severity,
});

describe("DeepResearchOutputSchema", () => {
  it("accepts a valid full output", () => {
    const result = DeepResearchOutputSchema.safeParse({
      vendor_name: "Acme",
      assessment_date: "2026-03-05",
      overall_risk_level: "MEDIUM",
      financial_health: makeDimension("MEDIUM"),
      legal_regulatory: makeDimension("LOW"),
      cybersecurity: makeDimension("LOW"),
      leadership_governance: makeDimension("LOW"),
      esg_reputation: makeDimension("LOW"),
      adverse_events: [
        {
          title: "Fine",
          date: "2026-01-15",
          category: "financial",
          severity: "MEDIUM",
          description: "Regulatory fine",
        },
      ],
      recommendation: "MONITOR",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid severity in dimension", () => {
    const result = DeepResearchOutputSchema.safeParse({
      vendor_name: "Acme",
      assessment_date: "2026-03-05",
      overall_risk_level: "LOW",
      financial_health: makeDimension("INVALID"),
      legal_regulatory: makeDimension(),
      cybersecurity: makeDimension(),
      leadership_governance: makeDimension(),
      esg_reputation: makeDimension(),
      adverse_events: [],
      recommendation: "APPROVE",
    });
    expect(result.success).toBe(false);
  });
});

describe("MonitorEventOutputSchema", () => {
  it("accepts valid monitor event output", () => {
    const result = MonitorEventOutputSchema.safeParse({
      event_summary: "Data breach disclosed",
      severity: "CRITICAL",
      adverse: true,
      event_type: "cybersecurity",
    });
    expect(result.success).toBe(true);
  });

  it("requires adverse as boolean", () => {
    expect(
      MonitorEventOutputSchema.safeParse({
        event_summary: "test",
        severity: "LOW",
        adverse: "yes",
        event_type: "legal",
      }).success,
    ).toBe(false);
  });
});

describe("RiskAssessmentSchema", () => {
  it("accepts a valid assessment", () => {
    const result = RiskAssessmentSchema.safeParse({
      risk_level: "HIGH",
      adverse_flag: true,
      risk_categories: ["cybersecurity", "legal"],
      summary: "Elevated risk due to breach and litigation.",
      action_required: true,
      recommendation: "initiate_contingency",
      severity_counts: { critical: 0, high: 2, medium: 0, low: 3 },
      triggered_overrides: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid recommendation", () => {
    expect(
      RiskAssessmentSchema.safeParse({
        risk_level: "LOW",
        adverse_flag: false,
        risk_categories: [],
        summary: "All clear",
        action_required: false,
        recommendation: "do_nothing",
        severity_counts: { critical: 0, high: 0, medium: 0, low: 5 },
        triggered_overrides: [],
      }).success,
    ).toBe(false);
  });
});

describe("SeverityCountsSchema", () => {
  it("rejects negative counts", () => {
    expect(
      SeverityCountsSchema.safeParse({
        critical: -1,
        high: 0,
        medium: 0,
        low: 0,
      }).success,
    ).toBe(false);
  });
});
