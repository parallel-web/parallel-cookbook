/**
 * Defensive scoring tests for the dashboard-side RiskScorer:
 *   - safeDim() backfills missing dimensions in DeepResearchOutput
 *   - scoreMonitorEvent collapses off-enum severity to LOW
 *   - scoreMonitorEvent tolerates null basis and missing event_type
 */
import { describe, it, expect } from "vitest";
import { RiskScorer, safeDim } from "@/lib/parallel/risk-scorer";
import { normalizeSeverity } from "@/lib/parallel/severity";
import type { DeepResearchOutput, MonitorEventOutput } from "@/lib/parallel/types";

const scorer = new RiskScorer();

describe("normalizeSeverity", () => {
  it("returns canonical tier for valid values regardless of case", () => {
    expect(normalizeSeverity("low")).toBe("LOW");
    expect(normalizeSeverity(" Medium ")).toBe("MEDIUM");
    expect(normalizeSeverity("HIGH")).toBe("HIGH");
    expect(normalizeSeverity("critical")).toBe("CRITICAL");
  });
  it("collapses off-enum / null / non-string to LOW", () => {
    expect(normalizeSeverity("INFO")).toBe("LOW");
    expect(normalizeSeverity("")).toBe("LOW");
    expect(normalizeSeverity(null)).toBe("LOW");
    expect(normalizeSeverity(undefined)).toBe("LOW");
    expect(normalizeSeverity(42)).toBe("LOW");
  });
});

describe("safeDim", () => {
  it("returns a fully-formed dimension when input is undefined", () => {
    const d = safeDim(undefined);
    expect(d).toEqual({ status: "unknown", findings: "", severity: "LOW" });
  });
  it("preserves provided fields and normalizes severity", () => {
    expect(safeDim({ status: "ok", findings: "f", severity: "high" as "HIGH" })).toEqual({
      status: "ok",
      findings: "f",
      severity: "HIGH",
    });
  });
});

describe("RiskScorer.scoreDeepResearch (defensive)", () => {
  it("doesn't throw when cybersecurity dimension is missing", () => {
    const partial = {
      vendor_name: "Acme",
      assessment_date: "2026-05-19",
      overall_risk_level: "LOW",
      financial_health: { status: "stable", findings: "", severity: "LOW" },
      legal_regulatory: { status: "stable", findings: "", severity: "LOW" },
      // cybersecurity intentionally omitted
      leadership_governance: { status: "stable", findings: "", severity: "LOW" },
      esg_reputation: { status: "stable", findings: "", severity: "LOW" },
      adverse_events: [],
      recommendation: "approve",
    } as unknown as DeepResearchOutput;
    expect(() => scorer.scoreDeepResearch(partial)).not.toThrow();
    const result = scorer.scoreDeepResearch(partial);
    expect(result.risk_level).toBe("LOW");
  });
});

describe("RiskScorer.scoreMonitorEvent (defensive)", () => {
  const ctx = { vendor_name: "Acme", vendor_domain: "acme.com", monitoring_priority: "high" };

  it('collapses off-enum severity "INFO" to LOW', () => {
    const event = { event_summary: "info", severity: "INFO", adverse: false, event_type: "leadership" } as unknown as MonitorEventOutput;
    const r = scorer.scoreMonitorEvent(event, ctx);
    expect(r.risk_level).toBe("LOW");
    expect(r.recommendation).toBe("continue_monitoring");
    expect(r.severity_counts).toEqual({ critical: 0, high: 0, medium: 0, low: 1 });
  });

  it("falls back to unknown event_type when missing", () => {
    const event = { event_summary: "x", severity: "MEDIUM", adverse: false, event_type: "" } as unknown as MonitorEventOutput;
    const r = scorer.scoreMonitorEvent(event, ctx);
    expect(r.risk_categories).toEqual(["unknown"]);
  });

  it("tolerates null basis", () => {
    const event: MonitorEventOutput = { event_summary: "s", severity: "MEDIUM", adverse: true, event_type: "legal" };
    expect(() => scorer.scoreMonitorEvent(event, ctx, null as unknown as undefined)).not.toThrow();
  });

  it("tolerates an empty event_summary", () => {
    const event: MonitorEventOutput = { event_summary: "", severity: "LOW", adverse: false, event_type: "esg" };
    const r = scorer.scoreMonitorEvent(event, ctx);
    expect(r.summary).toContain("Acme");
  });
});
