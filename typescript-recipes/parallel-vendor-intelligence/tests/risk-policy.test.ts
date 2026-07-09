import { describe, expect, it } from "vitest";

import { decideFollowUp, scoreReport } from "../src/risk-policy.js";
import { basis, vendorReport } from "./fixtures.js";

describe("scoreReport", () => {
  it("keeps an all-low report low", () => {
    const assessment = scoreReport(vendorReport());
    expect(assessment).toMatchObject({
      level: "LOW",
      evidenceLevel: "LOW",
      adverseDetected: false,
      requiresHumanReview: false,
      guidance: "continue_monitoring",
    });
  });

  it("lets every dimension drive aggregate risk, including operational resilience", () => {
    expect(scoreReport(vendorReport({ operational_resilience: "CRITICAL" })).level).toBe(
      "CRITICAL",
    );
  });

  it("uses adverse-event severity as an aggregate floor", () => {
    const assessment = scoreReport(
      vendorReport({}, [
        {
          category: "breach",
          severity: "HIGH",
          title: "Confirmed breach",
          summary: "Customer data may be affected.",
        },
      ]),
    );
    expect(assessment.level).toBe("HIGH");
    expect(assessment.adverseDetected).toBe(true);
  });

  it("requires analyst review for a medium adverse event", () => {
    const assessment = scoreReport(
      vendorReport({}, [
        {
          category: "operations",
          severity: "MEDIUM",
          title: "Regional service disruption",
          summary: "A limited disruption may affect delivery.",
        },
      ]),
    );
    expect(assessment).toMatchObject({
      level: "MEDIUM",
      adverseDetected: true,
      requiresHumanReview: true,
      guidance: "analyst_review",
    });
  });

  it("does not call several medium dimensions an adverse event", () => {
    const assessment = scoreReport(
      vendorReport({
        financial_health: "MEDIUM",
        legal_regulatory: "MEDIUM",
        cybersecurity: "MEDIUM",
      }),
    );
    expect(assessment.level).toBe("MEDIUM");
    expect(assessment.adverseDetected).toBe(false);
  });

  it("applies a vendor floor without fabricating evidence", () => {
    const assessment = scoreReport(vendorReport(), "HIGH", [basis("cybersecurity")]);
    expect(assessment.level).toBe("HIGH");
    expect(assessment.evidenceLevel).toBe("LOW");
    expect(assessment.citations).toEqual([]);
  });

  it("selects exact top-level evidence citations and deduplicates URLs", () => {
    const assessment = scoreReport(vendorReport({ cybersecurity: "HIGH" }), undefined, [
      basis("cybersecurity", "https://source.test/item"),
      basis("financial_health", "https://source.test/item"),
    ]);
    expect(assessment.citations).toEqual([
      expect.objectContaining({
        field: "cybersecurity",
        url: "https://source.test/item",
        reasoning: "cybersecurity reasoning",
        confidence: "high",
      }),
    ]);
  });
});

describe("decideFollowUp", () => {
  it("does not investigate an unrelated low change beside an unchanged high field", () => {
    const report = vendorReport({ cybersecurity: "HIGH" });
    expect(
      decideFollowUp({
        previousReport: report,
        currentReport: {
          ...report,
          financial_health: { ...report.financial_health, summary: "New low detail" },
        },
        changedFields: ["financial_health"],
        threshold: "HIGH",
      }).runFollowUp,
    ).toBe(false);
  });

  it("investigates both escalation into and resolution from a high level", () => {
    const low = vendorReport();
    const high = vendorReport({ cybersecurity: "HIGH" });
    expect(
      decideFollowUp({
        previousReport: low,
        currentReport: high,
        changedFields: ["cybersecurity"],
        threshold: "HIGH",
      }).runFollowUp,
    ).toBe(true);
    expect(
      decideFollowUp({
        previousReport: high,
        currentReport: low,
        changedFields: ["cybersecurity"],
        threshold: "HIGH",
      }).runFollowUp,
    ).toBe(true);
  });

  it("ignores an unchanged high adverse event when only a low event is added", () => {
    const existing = {
      category: "breach",
      severity: "HIGH" as const,
      title: "Historical breach",
      summary: "Previously known.",
    };
    const previous = vendorReport({}, [existing]);
    const current = vendorReport({}, [
      existing,
      {
        category: "reputation",
        severity: "LOW",
        title: "Minor complaint",
        summary: "Low-signal complaint.",
      },
    ]);
    expect(
      decideFollowUp({
        previousReport: previous,
        currentReport: current,
        changedFields: ["adverse_events"],
        threshold: "HIGH",
      }).runFollowUp,
    ).toBe(false);
  });

  it("uses a configured high vendor floor for any changed risk field", () => {
    const report = vendorReport();
    expect(
      decideFollowUp({
        previousReport: report,
        currentReport: report,
        changedFields: ["financial_health"],
        threshold: "HIGH",
        riskFloor: "HIGH",
      }).reasons,
    ).toContainEqual({ kind: "vendor_floor", level: "HIGH" });
  });

  it("represents a high adverse-event resolution as one before-and-after reason", () => {
    const previous = vendorReport({}, [
      {
        category: "breach",
        severity: "HIGH",
        title: "Security incident",
        summary: "The incident is under investigation.",
        event_date: "2026-07-01",
      },
    ]);
    const current = vendorReport({}, [
      {
        category: "breach",
        severity: "LOW",
        title: "Security incident",
        summary: "The incident was contained.",
        event_date: "2026-07-01",
      },
    ]);
    const decision = decideFollowUp({
      previousReport: previous,
      currentReport: current,
      changedFields: ["adverse_events"],
      threshold: "HIGH",
    });
    expect(decision.reasons).toEqual([
      {
        kind: "changed_adverse_event",
        title: "Security incident",
        previousLevel: "HIGH",
        currentLevel: "LOW",
      },
    ]);
    expect(decision.requiresHumanReview).toBe(true);
  });

  it("rejects unknown changed fields instead of silently discarding them", () => {
    const report = vendorReport();
    expect(() =>
      decideFollowUp({
        previousReport: report,
        currentReport: report,
        changedFields: ["unknown_field"],
        threshold: "HIGH",
      }),
    ).toThrow();
  });
});
