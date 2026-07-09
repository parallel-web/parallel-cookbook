import { describe, expect, it } from "vitest";

import {
  ChangeInvestigationSchema,
  buildBaselineTaskParams,
  buildChangeInvestigationTaskParams,
  normalizeVendorDomain,
  RISK_DIMENSIONS,
  VENDOR_REPORT_OUTPUT_SCHEMA,
  VendorReportSchema,
  VendorSchema,
} from "../src/schema.js";

const dimension = {
  severity: "LOW" as const,
  summary: "No material current risk found.",
  findings: [],
};

const validReport = {
  financial_health: dimension,
  legal_regulatory: dimension,
  operational_resilience: dimension,
  leadership_governance: dimension,
  esg_reputation: dimension,
  cybersecurity: dimension,
  adverse_events: [],
};

describe("vendor domain normalization", () => {
  it.each([
    ["Example.COM", "example.com"],
    ["https://Example.COM/path?query=1", "example.com"],
    ["http://sub.example.com./", "sub.example.com"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeVendorDomain(input)).toBe(expected);
  });

  it.each([
    "",
    "localhost",
    "127.0.0.1",
    "https://10.0.0.1",
    "foo..com",
    "-bad.example.com",
    "mailto:test@example.com",
    "https://user:pass@example.com",
  ])(
    "rejects unsupported input %s",
    (input) => {
      expect(() => normalizeVendorDomain(input)).toThrow();
    },
  );
});

describe("vendor assessment contract", () => {
  it("exposes six flat dimensions plus adverse events", () => {
    expect(RISK_DIMENSIONS.map(({ key }) => key)).toEqual([
      "financial_health",
      "legal_regulatory",
      "operational_resilience",
      "leadership_governance",
      "esg_reputation",
      "cybersecurity",
    ]);
    expect(VendorReportSchema.parse(validReport)).toEqual(validReport);
  });

  it("rejects prototype-only and volatile fields", () => {
    expect(() =>
      VendorReportSchema.parse({
        ...validReport,
        assessment_date: "2026-07-09",
      }),
    ).toThrow();
    expect(() =>
      VendorReportSchema.parse({
        dimensions: validReport,
        adverse_events: [],
      }),
    ).toThrow();
    expect(() =>
      VendorReportSchema.parse({
        ...validReport,
        cybersecurity: {
          ...dimension,
          status: "LOW",
        },
      }),
    ).toThrow();
  });

  it("generates a top-level JSON schema for Task field basis", () => {
    const jsonSchema = VENDOR_REPORT_OUTPUT_SCHEMA.json_schema as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };

    expect(Object.keys(jsonSchema.properties ?? {})).toEqual([
      ...RISK_DIMENSIONS.map(({ key }) => key),
      "adverse_events",
    ]);
    expect(jsonSchema.required).toEqual([
      ...RISK_DIMENSIONS.map(({ key }) => key),
      "adverse_events",
    ]);
    expect(jsonSchema.additionalProperties).toBe(false);
  });

  it("builds a stable baseline Task without current-time input", () => {
    const vendor = VendorSchema.parse({
      name: "Example",
      domain: "https://EXAMPLE.com/path",
      riskFloor: "MEDIUM",
    });
    const params = buildBaselineTaskParams(vendor, "core");

    expect(params.input).toMatchObject({
      vendor_name: "Example",
      vendor_domain: "example.com",
    });
    expect(params.processor).toBe("core");
    expect(JSON.stringify(params)).not.toContain("assessment_date");
  });

  it("rejects model-owned human guidance from focused follow-ups", () => {
    expect(() =>
      ChangeInvestigationSchema.parse({
        what_changed: "A change",
        confirmed_facts: [],
        business_impact: "Impact",
        open_questions: [],
        recommended_human_action: "urgent_human_review",
      }),
    ).toThrow();
  });

  it("rejects unknown changed fields before building focused research input", () => {
    expect(() =>
      Reflect.apply(buildChangeInvestigationTaskParams, undefined, [
        {
          vendor: { name: "Example", domain: "example.com" },
          eventId: "event-1",
          changedFields: ["unknown_field"],
          previousReport: validReport,
          currentReport: validReport,
          policyDecision: {
            threshold: "HIGH",
            previousLevel: "LOW",
            currentLevel: "LOW",
            requiresHumanReview: false,
            reasons: [],
          },
          processor: "pro",
        },
      ]),
    ).toThrow();
  });
});
