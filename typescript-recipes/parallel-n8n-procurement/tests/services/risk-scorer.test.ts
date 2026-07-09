import { describe, it, expect } from "vitest";
import { RiskScorer } from "@/services/risk-scorer.js";
import type { DeepResearchOutput, MonitorEventOutput } from "@/models/risk-assessment.js";
import type { RiskTier } from "@/models/vendor.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function dim(severity: RiskTier = "LOW", status?: string) {
  return {
    status: status ?? (severity === "LOW" ? "stable" : "issues"),
    findings: `Test findings for ${severity}`,
    severity,
  };
}

function makeOutput(overrides: Partial<DeepResearchOutput> = {}): DeepResearchOutput {
  return {
    vendor_name: "TestCo",
    assessment_date: "2026-03-05",
    overall_risk_level: "LOW",
    financial_health: dim("LOW"),
    legal_regulatory: dim("LOW"),
    cybersecurity: dim("LOW"),
    leadership_governance: dim("LOW"),
    esg_reputation: dim("LOW"),
    adverse_events: [],
    recommendation: "APPROVE",
    ...overrides,
  };
}

const scorer = new RiskScorer();

// ── Risk Level Assignment Table ────────────────────────────────────────────

describe("Risk Level Assignment Table", () => {
  it("any critical finding → CRITICAL, adverse=true", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ cybersecurity: dim("CRITICAL") }),
    );
    expect(result.risk_level).toBe("CRITICAL");
    expect(result.adverse_flag).toBe(true);
  });

  it("≥2 high findings → HIGH, adverse=true", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({
        financial_health: dim("HIGH"),
        legal_regulatory: dim("HIGH"),
      }),
    );
    expect(result.risk_level).toBe("HIGH");
    expect(result.adverse_flag).toBe(true);
    expect(result.severity_counts.high).toBe(2);
  });

  it("1 high finding → HIGH, adverse=true", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ leadership_governance: dim("HIGH") }),
    );
    expect(result.risk_level).toBe("HIGH");
    expect(result.adverse_flag).toBe(true);
    expect(result.severity_counts.high).toBe(1);
  });

  it("≥3 medium findings across 2+ categories → MEDIUM, adverse=true", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({
        financial_health: dim("MEDIUM"),
        legal_regulatory: dim("MEDIUM"),
        esg_reputation: dim("MEDIUM"),
      }),
    );
    expect(result.risk_level).toBe("MEDIUM");
    expect(result.adverse_flag).toBe(true);
    expect(result.severity_counts.medium).toBe(3);
  });

  it("≥3 medium findings in same-type categories → still counts distinct dimension names", () => {
    // 3 different dimensions all MEDIUM → 3 distinct categories → adverse=true
    const result = scorer.scoreDeepResearch(
      makeOutput({
        financial_health: dim("MEDIUM"),
        cybersecurity: dim("MEDIUM"),
        leadership_governance: dim("MEDIUM"),
      }),
    );
    expect(result.risk_level).toBe("MEDIUM");
    expect(result.adverse_flag).toBe(true);
  });

  it("2 medium findings → MEDIUM, adverse=false", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({
        financial_health: dim("MEDIUM"),
        legal_regulatory: dim("MEDIUM"),
      }),
    );
    expect(result.risk_level).toBe("MEDIUM");
    expect(result.adverse_flag).toBe(false);
  });

  it("1 medium finding → MEDIUM, adverse=false", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ esg_reputation: dim("MEDIUM") }),
    );
    expect(result.risk_level).toBe("MEDIUM");
    expect(result.adverse_flag).toBe(false);
  });

  it("all low → LOW, adverse=false", () => {
    const result = scorer.scoreDeepResearch(makeOutput());
    expect(result.risk_level).toBe("LOW");
    expect(result.adverse_flag).toBe(false);
    expect(result.severity_counts.low).toBe(5);
  });
});

// ── Risk Categories ────────────────────────────────────────────────────────

describe("risk_categories tracking", () => {
  it("includes category names for HIGH+ dimensions", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({
        financial_health: dim("HIGH"),
        cybersecurity: dim("CRITICAL"),
      }),
    );
    expect(result.risk_categories).toContain("financial_health");
    expect(result.risk_categories).toContain("cybersecurity");
    expect(result.risk_categories).not.toContain("legal_regulatory");
  });
});

// ── Override Rules ─────────────────────────────────────────────────────────

describe("Override Rules", () => {
  it("risk_tier_override as floor raises computed LOW to HIGH", () => {
    const result = scorer.scoreDeepResearch(makeOutput(), {
      risk_tier_override: "HIGH",
    });
    expect(result.risk_level).toBe("HIGH");
    expect(result.triggered_overrides).toContain("risk_tier_override_HIGH");
  });

  it("risk_tier_override does not reduce — floor only", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ financial_health: dim("HIGH") }),
      { risk_tier_override: "MEDIUM" },
    );
    expect(result.risk_level).toBe("HIGH");
    expect(result.triggered_overrides).not.toContain("risk_tier_override_MEDIUM");
  });

  it("cybersecurity status CRITICAL forces CRITICAL (active breach)", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ cybersecurity: dim("LOW", "CRITICAL") }),
    );
    expect(result.risk_level).toBe("CRITICAL");
    expect(result.adverse_flag).toBe(true);
    expect(result.triggered_overrides).toContain("active_data_breach");
  });

  it("legal_regulatory status CRITICAL forces HIGH minimum", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ legal_regulatory: dim("LOW", "CRITICAL") }),
    );
    expect(result.risk_level).toBe("HIGH");
    expect(result.adverse_flag).toBe(true);
    expect(result.triggered_overrides).toContain("active_government_litigation");
  });

  it("breach + govt litigation combined → CRITICAL (breach wins)", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({
        cybersecurity: dim("LOW", "CRITICAL"),
        legal_regulatory: dim("LOW", "CRITICAL"),
      }),
    );
    expect(result.risk_level).toBe("CRITICAL");
    expect(result.adverse_flag).toBe(true);
    expect(result.triggered_overrides).toContain("active_data_breach");
    expect(result.triggered_overrides).toContain("active_government_litigation");
  });

  it("override + breach combined → both in triggered_overrides", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ cybersecurity: dim("LOW", "CRITICAL") }),
      { risk_tier_override: "HIGH" },
    );
    expect(result.risk_level).toBe("CRITICAL");
    expect(result.triggered_overrides).toContain("active_data_breach");
    // Override doesn't fire because CRITICAL > HIGH
    expect(result.triggered_overrides).not.toContain("risk_tier_override_HIGH");
  });

  it("override raises LOW to MEDIUM when no other overrides", () => {
    const result = scorer.scoreDeepResearch(makeOutput(), {
      risk_tier_override: "MEDIUM",
    });
    expect(result.risk_level).toBe("MEDIUM");
    expect(result.triggered_overrides).toContain("risk_tier_override_MEDIUM");
  });
});

// ── Derived Fields ─────────────────────────────────────────────────────────

describe("Derived fields", () => {
  it("HIGH → action_required=true", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ financial_health: dim("HIGH") }),
    );
    expect(result.action_required).toBe(true);
  });

  it("CRITICAL → action_required=true", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ financial_health: dim("CRITICAL") }),
    );
    expect(result.action_required).toBe(true);
  });

  it("MEDIUM → action_required=false", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ financial_health: dim("MEDIUM") }),
    );
    expect(result.action_required).toBe(false);
  });

  it("LOW → action_required=false", () => {
    const result = scorer.scoreDeepResearch(makeOutput());
    expect(result.action_required).toBe(false);
  });

  it("LOW → recommendation=continue_monitoring", () => {
    const result = scorer.scoreDeepResearch(makeOutput());
    expect(result.recommendation).toBe("continue_monitoring");
  });

  it("MEDIUM → recommendation=escalate_review", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ financial_health: dim("MEDIUM") }),
    );
    expect(result.recommendation).toBe("escalate_review");
  });

  it("HIGH → recommendation=initiate_contingency", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ financial_health: dim("HIGH") }),
    );
    expect(result.recommendation).toBe("initiate_contingency");
  });

  it("CRITICAL → recommendation=suspend_relationship", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ financial_health: dim("CRITICAL") }),
    );
    expect(result.recommendation).toBe("suspend_relationship");
  });

  it("summary includes vendor name and risk level", () => {
    const result = scorer.scoreDeepResearch(makeOutput());
    expect(result.summary).toContain("TestCo");
    expect(result.summary).toContain("LOW");
  });

  it("summary mentions adverse when flagged", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({ financial_health: dim("HIGH") }),
    );
    expect(result.summary).toContain("Adverse");
  });
});

// ── Edge Cases ─────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("all dimensions LOW with empty adverse_events", () => {
    const result = scorer.scoreDeepResearch(makeOutput());
    expect(result.risk_level).toBe("LOW");
    expect(result.adverse_flag).toBe(false);
    expect(result.risk_categories).toEqual([]);
    expect(result.severity_counts).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 5,
    });
    expect(result.triggered_overrides).toEqual([]);
  });

  it("severity counts are correct with mixed severities", () => {
    const result = scorer.scoreDeepResearch(
      makeOutput({
        financial_health: dim("CRITICAL"),
        legal_regulatory: dim("HIGH"),
        cybersecurity: dim("MEDIUM"),
        leadership_governance: dim("LOW"),
        esg_reputation: dim("LOW"),
      }),
    );
    expect(result.severity_counts).toEqual({
      critical: 1,
      high: 1,
      medium: 1,
      low: 2,
    });
  });
});

// ── Monitor Event Scoring ──────────────────────────────────────────────────

describe("scoreMonitorEvent", () => {
  const vendorContext = {
    vendor_name: "Acme Corp",
    vendor_domain: "https://acme.com",
    monitoring_priority: "high",
  };

  it("HIGH severity event → HIGH risk_level", () => {
    const event: MonitorEventOutput = {
      event_summary: "Executive departures announced",
      severity: "HIGH",
      adverse: true,
      event_type: "leadership",
    };
    const result = scorer.scoreMonitorEvent(event, vendorContext);
    expect(result.risk_level).toBe("HIGH");
  });

  it("adverse=true maps correctly", () => {
    const event: MonitorEventOutput = {
      event_summary: "Data breach disclosed",
      severity: "CRITICAL",
      adverse: true,
      event_type: "cybersecurity",
    };
    const result = scorer.scoreMonitorEvent(event, vendorContext);
    expect(result.adverse_flag).toBe(true);
  });

  it("adverse=false maps correctly", () => {
    const event: MonitorEventOutput = {
      event_summary: "Routine certification renewal",
      severity: "LOW",
      adverse: false,
      event_type: "compliance",
    };
    const result = scorer.scoreMonitorEvent(event, vendorContext);
    expect(result.adverse_flag).toBe(false);
  });

  it("risk_categories contains event_type", () => {
    const event: MonitorEventOutput = {
      event_summary: "Regulatory fine",
      severity: "MEDIUM",
      adverse: false,
      event_type: "legal_regulatory",
    };
    const result = scorer.scoreMonitorEvent(event, vendorContext);
    expect(result.risk_categories).toEqual(["legal_regulatory"]);
  });

  it("severity_counts has 1 in the correct bucket", () => {
    const event: MonitorEventOutput = {
      event_summary: "test",
      severity: "HIGH",
      adverse: true,
      event_type: "financial",
    };
    const result = scorer.scoreMonitorEvent(event, vendorContext);
    expect(result.severity_counts).toEqual({
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
    });
  });

  it("action_required=true for CRITICAL event", () => {
    const event: MonitorEventOutput = {
      event_summary: "Critical breach",
      severity: "CRITICAL",
      adverse: true,
      event_type: "cyber",
    };
    const result = scorer.scoreMonitorEvent(event, vendorContext);
    expect(result.action_required).toBe(true);
    expect(result.recommendation).toBe("suspend_relationship");
  });

  it("action_required=false for LOW event", () => {
    const event: MonitorEventOutput = {
      event_summary: "Minor update",
      severity: "LOW",
      adverse: false,
      event_type: "news",
    };
    const result = scorer.scoreMonitorEvent(event, vendorContext);
    expect(result.action_required).toBe(false);
    expect(result.recommendation).toBe("continue_monitoring");
  });

  it("summary includes vendor name and event summary", () => {
    const event: MonitorEventOutput = {
      event_summary: "Lawsuit filed",
      severity: "HIGH",
      adverse: true,
      event_type: "legal",
    };
    const result = scorer.scoreMonitorEvent(event, vendorContext);
    expect(result.summary).toContain("Acme Corp");
    expect(result.summary).toContain("Lawsuit filed");
  });

  it("triggered_overrides is always empty for monitor events", () => {
    const event: MonitorEventOutput = {
      event_summary: "test",
      severity: "CRITICAL",
      adverse: true,
      event_type: "cyber",
    };
    const result = scorer.scoreMonitorEvent(event, vendorContext);
    expect(result.triggered_overrides).toEqual([]);
  });
});
