import { describe, it, expect } from "vitest";
import { SlackFormatter } from "@/services/slack-formatter.js";
import type { RiskAssessment, AdverseEvent, MonitorEventOutput } from "@/models/risk-assessment.js";
import type { Vendor } from "@/models/vendor.js";
import type { SlackBlock } from "@/models/slack.js";

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

function makeAssessment(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    risk_level: "HIGH",
    adverse_flag: true,
    risk_categories: ["cybersecurity", "legal_regulatory"],
    summary: "Elevated risk due to data breach and pending litigation.",
    action_required: true,
    recommendation: "initiate_contingency",
    severity_counts: { critical: 0, high: 2, medium: 1, low: 2 },
    triggered_overrides: [],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<AdverseEvent> = {}): AdverseEvent {
  return {
    title: "Data Breach Disclosed",
    date: "2026-03-01",
    category: "cybersecurity",
    severity: "HIGH",
    source_url: "https://news.example.com/breach",
    description: "Customer data exposed in security incident",
    ...overrides,
  };
}

function blocksText(blocks: SlackBlock[]): string {
  return JSON.stringify(blocks);
}

const formatter = new SlackFormatter({
  channels: {
    critical: "#test-critical",
    alert: "#test-alert",
    digest: "#test-digest",
  },
});

// ── routeByRiskLevel ───────────────────────────────────────────────────────

describe("routeByRiskLevel", () => {
  it("CRITICAL → critical channel", () => {
    expect(formatter.routeByRiskLevel("CRITICAL")).toBe("#test-critical");
  });

  it("HIGH → alert channel", () => {
    expect(formatter.routeByRiskLevel("HIGH")).toBe("#test-alert");
  });

  it("MEDIUM → digest channel", () => {
    expect(formatter.routeByRiskLevel("MEDIUM")).toBe("#test-digest");
  });

  it("LOW → digest channel", () => {
    expect(formatter.routeByRiskLevel("LOW")).toBe("#test-digest");
  });
});

// ── Default channels ───────────────────────────────────────────────────────

describe("default channels", () => {
  it("uses default channel names when none provided", () => {
    const defaultFormatter = new SlackFormatter();
    expect(defaultFormatter.routeByRiskLevel("CRITICAL")).toBe("#procurement-critical");
    expect(defaultFormatter.routeByRiskLevel("HIGH")).toBe("#procurement-alerts");
    expect(defaultFormatter.routeByRiskLevel("MEDIUM")).toBe("#procurement-digest");
  });
});

// ── formatCriticalAlert ────────────────────────────────────────────────────

describe("formatCriticalAlert", () => {
  it("CRITICAL alert has red circle emoji in header", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment({ risk_level: "CRITICAL" }),
      makeVendor(),
      [makeFinding()],
    );
    const headerText = (msg.blocks[0] as Record<string, any>).text.text;
    expect(headerText).toContain("\ud83d\udd34");
    expect(headerText).toContain("CRITICAL VENDOR RISK ALERT");
  });

  it("HIGH alert has orange circle emoji in header", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment({ risk_level: "HIGH" }),
      makeVendor(),
      [makeFinding()],
    );
    const headerText = (msg.blocks[0] as Record<string, any>).text.text;
    expect(headerText).toContain("\ud83d\udfe0");
    expect(headerText).toContain("HIGH VENDOR RISK ALERT");
  });

  it("CRITICAL routes to critical channel", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment({ risk_level: "CRITICAL" }),
      makeVendor(),
      [],
    );
    expect(msg.channel).toBe("#test-critical");
  });

  it("HIGH routes to alert channel", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment({ risk_level: "HIGH" }),
      makeVendor(),
      [],
    );
    expect(msg.channel).toBe("#test-alert");
  });

  it("includes vendor name in blocks", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor({ vendor_name: "TestCo" }),
      [],
    );
    expect(blocksText(msg.blocks)).toContain("TestCo");
  });

  it("includes findings with source URLs", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor(),
      [makeFinding({ source_url: "https://example.com/article" })],
    );
    expect(blocksText(msg.blocks)).toContain("https://example.com/article");
  });

  it("handles findings with missing source_url", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor(),
      [makeFinding({ source_url: undefined })],
    );
    expect(blocksText(msg.blocks)).toContain("Data Breach Disclosed");
    expect(blocksText(msg.blocks)).not.toContain("source>");
  });

  it("handles empty findings array", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor(),
      [],
    );
    expect(blocksText(msg.blocks)).not.toContain("Key Findings");
  });

  it("has non-empty text fallback", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor(),
      [],
    );
    expect(msg.text.length).toBeGreaterThan(0);
    expect(msg.text).toContain("Acme Corp");
  });

  it("CRITICAL has '24 hours' action required", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment({ risk_level: "CRITICAL" }),
      makeVendor(),
      [],
    );
    expect(blocksText(msg.blocks)).toContain("24 hours");
  });

  it("HIGH has '48 hours' action required", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment({ risk_level: "HIGH" }),
      makeVendor(),
      [],
    );
    expect(blocksText(msg.blocks)).toContain("48 hours");
  });

  it("includes risk categories", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment({ risk_categories: ["cybersecurity", "financial_health"] }),
      makeVendor(),
      [],
    );
    expect(blocksText(msg.blocks)).toContain("cybersecurity");
    expect(blocksText(msg.blocks)).toContain("financial_health");
  });

  it("has classification ADVERSE when adverse_flag is true", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment({ adverse_flag: true }),
      makeVendor(),
      [],
    );
    expect(blocksText(msg.blocks)).toContain("ADVERSE");
  });

  it("has classification MONITORING when adverse_flag is false", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment({ adverse_flag: false }),
      makeVendor(),
      [],
    );
    expect(blocksText(msg.blocks)).toContain("MONITORING");
  });

  it("truncates very long summaries", () => {
    const longSummary = "A".repeat(3000);
    const msg = formatter.formatCriticalAlert(
      makeAssessment({ summary: longSummary }),
      makeVendor(),
      [],
    );
    // Find the section block with the summary
    const summaryBlock = msg.blocks.find(
      (b) =>
        b.type === "section" &&
        typeof (b as any).text?.text === "string" &&
        (b as any).text.text.startsWith("AAAA"),
    );
    expect(summaryBlock).toBeDefined();
    const text = (summaryBlock as any).text.text as string;
    expect(text.length).toBeLessThanOrEqual(2003); // 2000 + "..."
    expect(text.endsWith("...")).toBe(true);
  });

  it("includes divider blocks", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor(),
      [],
    );
    const dividers = msg.blocks.filter((b) => b.type === "divider");
    expect(dividers.length).toBeGreaterThanOrEqual(2);
  });

  it("includes context blocks", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor(),
      [],
    );
    const contexts = msg.blocks.filter((b) => b.type === "context");
    expect(contexts.length).toBeGreaterThanOrEqual(2);
  });
});

// ── formatDailyDigest ──────────────────────────────────────────────────────

describe("formatDailyDigest", () => {
  it("header includes date", () => {
    const msg = formatter.formatDailyDigest(
      [makeAssessment({ risk_level: "MEDIUM" })],
      "2026-03-05",
    );
    const headerText = (msg.blocks[0] as any).text.text;
    expect(headerText).toContain("2026-03-05");
  });

  it("shows total vendor count and adverse count", () => {
    const assessments = [
      makeAssessment({ risk_level: "MEDIUM", adverse_flag: true }),
      makeAssessment({ risk_level: "LOW", adverse_flag: false }),
      makeAssessment({ risk_level: "HIGH", adverse_flag: true }),
    ];
    const msg = formatter.formatDailyDigest(assessments, "2026-03-05");
    expect(blocksText(msg.blocks)).toContain("3");
    expect(blocksText(msg.blocks)).toContain("2"); // adverse count
  });

  it("handles empty assessments array", () => {
    const msg = formatter.formatDailyDigest([], "2026-03-05");
    expect(msg.blocks.length).toBeGreaterThan(0);
    expect(blocksText(msg.blocks)).toContain("0");
  });

  it("channel is digest", () => {
    const msg = formatter.formatDailyDigest([makeAssessment()], "2026-03-05");
    expect(msg.channel).toBe("#test-digest");
  });

  it("shows low-risk vendor count", () => {
    const assessments = [
      makeAssessment({ risk_level: "LOW", adverse_flag: false }),
      makeAssessment({ risk_level: "LOW", adverse_flag: false }),
    ];
    const msg = formatter.formatDailyDigest(assessments, "2026-03-05");
    expect(blocksText(msg.blocks)).toContain("2 vendors assessed with no significant findings");
  });

  it("text fallback is non-empty", () => {
    const msg = formatter.formatDailyDigest([makeAssessment()], "2026-03-05");
    expect(msg.text.length).toBeGreaterThan(0);
  });
});

// ── formatAdHocResult ──────────────────────────────────────────────────────

describe("formatAdHocResult", () => {
  it("includes requestedBy name", () => {
    const msg = formatter.formatAdHocResult(
      makeAssessment(),
      makeVendor(),
      "jane.doe",
    );
    expect(blocksText(msg.blocks)).toContain("jane.doe");
  });

  it("has thread_ts defined", () => {
    const msg = formatter.formatAdHocResult(
      makeAssessment(),
      makeVendor(),
      "jane.doe",
    );
    expect(msg.thread_ts).toBeDefined();
  });

  it("includes risk level and recommendation", () => {
    const msg = formatter.formatAdHocResult(
      makeAssessment({ risk_level: "HIGH", recommendation: "initiate_contingency" }),
      makeVendor(),
      "jane.doe",
    );
    expect(blocksText(msg.blocks)).toContain("HIGH");
    expect(blocksText(msg.blocks)).toContain("initiate_contingency");
  });

  it("includes severity counts", () => {
    const msg = formatter.formatAdHocResult(
      makeAssessment({ severity_counts: { critical: 1, high: 2, medium: 3, low: 4 } }),
      makeVendor(),
      "jane.doe",
    );
    const text = blocksText(msg.blocks);
    expect(text).toContain("1 critical");
    expect(text).toContain("2 high");
    expect(text).toContain("3 medium");
    expect(text).toContain("4 low");
  });

  it("includes vendor name in header", () => {
    const msg = formatter.formatAdHocResult(
      makeAssessment(),
      makeVendor({ vendor_name: "SpecialCo" }),
      "user",
    );
    const headerText = (msg.blocks[0] as any).text.text;
    expect(headerText).toContain("SpecialCo");
  });

  it("includes action required for HIGH+ assessments", () => {
    const msg = formatter.formatAdHocResult(
      makeAssessment({ action_required: true }),
      makeVendor(),
      "user",
    );
    expect(blocksText(msg.blocks)).toContain("Action Required");
  });
});

// ── formatMonitorAlert ─────────────────────────────────────────────────────

describe("formatMonitorAlert", () => {
  const event: MonitorEventOutput = {
    event_summary: "Regulatory fine imposed",
    severity: "HIGH",
    adverse: true,
    event_type: "legal_regulatory",
  };

  it("uses correct emoji for severity", () => {
    const msg = formatter.formatMonitorAlert(
      makeAssessment({ risk_level: "HIGH" }),
      makeVendor(),
      event,
    );
    const headerText = (msg.blocks[0] as any).text.text;
    expect(headerText).toContain("\ud83d\udfe0"); // orange
  });

  it("includes event summary", () => {
    const msg = formatter.formatMonitorAlert(
      makeAssessment(),
      makeVendor(),
      event,
    );
    expect(blocksText(msg.blocks)).toContain("Regulatory fine imposed");
  });

  it("includes event type", () => {
    const msg = formatter.formatMonitorAlert(
      makeAssessment(),
      makeVendor(),
      event,
    );
    expect(blocksText(msg.blocks)).toContain("legal_regulatory");
  });

  it("includes vendor name in header", () => {
    const msg = formatter.formatMonitorAlert(
      makeAssessment(),
      makeVendor({ vendor_name: "MonitoredCo" }),
      event,
    );
    const headerText = (msg.blocks[0] as any).text.text;
    expect(headerText).toContain("MonitoredCo");
  });

  it("channel routed by risk level", () => {
    const msg = formatter.formatMonitorAlert(
      makeAssessment({ risk_level: "CRITICAL" }),
      makeVendor(),
      { ...event, severity: "CRITICAL" },
    );
    expect(msg.channel).toBe("#test-critical");
  });

  it("has no thread_ts (not a thread reply)", () => {
    const msg = formatter.formatMonitorAlert(
      makeAssessment(),
      makeVendor(),
      event,
    );
    expect(msg.thread_ts).toBeUndefined();
  });

  it("text fallback includes vendor name and event summary", () => {
    const msg = formatter.formatMonitorAlert(
      makeAssessment(),
      makeVendor({ vendor_name: "TestCo" }),
      event,
    );
    expect(msg.text).toContain("TestCo");
    expect(msg.text).toContain("Regulatory fine imposed");
  });
});

// ── Block Structure ────────────────────────────────────────────────────────

describe("block structure", () => {
  it("all blocks have a type field", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor(),
      [makeFinding()],
    );
    for (const block of msg.blocks) {
      expect(block).toHaveProperty("type");
    }
  });

  it("header blocks use plain_text", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor(),
      [],
    );
    const header = msg.blocks[0] as any;
    expect(header.type).toBe("header");
    expect(header.text.type).toBe("plain_text");
  });

  it("section blocks use mrkdwn", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor(),
      [],
    );
    const sections = msg.blocks.filter((b) => b.type === "section");
    for (const s of sections) {
      expect((s as any).text.type).toBe("mrkdwn");
    }
  });

  it("context blocks have elements array", () => {
    const msg = formatter.formatCriticalAlert(
      makeAssessment(),
      makeVendor(),
      [],
    );
    const contexts = msg.blocks.filter((b) => b.type === "context");
    for (const c of contexts) {
      expect(Array.isArray((c as any).elements)).toBe(true);
    }
  });
});
