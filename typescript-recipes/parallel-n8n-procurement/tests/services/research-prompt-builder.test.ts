import { describe, it, expect } from "vitest";
import { ResearchPromptBuilder } from "@/services/research-prompt-builder.js";
import type { Vendor } from "@/models/vendor.js";

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

describe("ResearchPromptBuilder", () => {
  const builder = new ResearchPromptBuilder();

  describe("buildPrompt", () => {
    it("includes vendor name", () => {
      const prompt = builder.buildPrompt(makeVendor({ vendor_name: "Tesla Inc" }));
      expect(prompt).toContain("Tesla Inc");
    });

    it("includes vendor domain", () => {
      const prompt = builder.buildPrompt(makeVendor({ vendor_domain: "https://tesla.com" }));
      expect(prompt).toContain("https://tesla.com");
    });

    it("includes vendor category", () => {
      const prompt = builder.buildPrompt(makeVendor({ vendor_category: "manufacturing" }));
      expect(prompt).toContain("manufacturing");
    });

    it("covers financial health investigation area", () => {
      const prompt = builder.buildPrompt(makeVendor());
      expect(prompt).toContain("FINANCIAL HEALTH");
      expect(prompt).toContain("earnings");
      expect(prompt).toContain("credit ratings");
      expect(prompt).toContain("debt");
      expect(prompt).toContain("funding");
    });

    it("covers legal & regulatory investigation area", () => {
      const prompt = builder.buildPrompt(makeVendor());
      expect(prompt).toContain("LEGAL & REGULATORY");
      expect(prompt).toContain("litigation");
      expect(prompt).toContain("regulatory actions");
      expect(prompt).toContain("sanctions");
      expect(prompt).toContain("compliance");
    });

    it("covers operational risk investigation area", () => {
      const prompt = builder.buildPrompt(makeVendor());
      expect(prompt).toContain("OPERATIONAL RISK");
      expect(prompt).toContain("outages");
      expect(prompt).toContain("data breaches");
      expect(prompt).toContain("supply chain");
    });

    it("covers leadership & governance investigation area", () => {
      const prompt = builder.buildPrompt(makeVendor());
      expect(prompt).toContain("LEADERSHIP & GOVERNANCE");
      expect(prompt).toContain("executive departures");
      expect(prompt).toContain("board");
      expect(prompt).toContain("M&A");
    });

    it("covers ESG & reputation investigation area", () => {
      const prompt = builder.buildPrompt(makeVendor());
      expect(prompt).toContain("ESG & REPUTATION");
      expect(prompt).toContain("environmental violations");
      expect(prompt).toContain("labor disputes");
      expect(prompt).toContain("negative press");
    });

    it("covers cybersecurity posture investigation area", () => {
      const prompt = builder.buildPrompt(makeVendor());
      expect(prompt).toContain("CYBERSECURITY POSTURE");
      expect(prompt).toContain("vulnerabilities");
      expect(prompt).toContain("breach history");
      expect(prompt).toContain("certifications");
    });

    it("instructs severity classification", () => {
      const prompt = builder.buildPrompt(makeVendor());
      expect(prompt).toContain("LOW, MEDIUM, HIGH, CRITICAL");
    });

    it("instructs source URL and date requirements", () => {
      const prompt = builder.buildPrompt(makeVendor());
      expect(prompt).toContain("source URLs");
      expect(prompt).toContain("dates");
    });
  });

  describe("getOutputSchema", () => {
    const schema = builder.getOutputSchema();

    it("returns type json", () => {
      expect(schema.type).toBe("json");
    });

    it("has json_schema property", () => {
      expect(schema.json_schema).toBeDefined();
    });

    const jsonSchema = builder.getOutputSchema().json_schema!;

    it("has vendor_name property", () => {
      expect(jsonSchema.properties).toHaveProperty("vendor_name");
    });

    it("has assessment_date property", () => {
      expect(jsonSchema.properties).toHaveProperty("assessment_date");
    });

    it("has overall_risk_level with enum constraint", () => {
      const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
      expect(props.overall_risk_level).toHaveProperty("enum");
      expect(props.overall_risk_level.enum).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    });

    it("has recommendation with enum constraint", () => {
      const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
      expect(props.recommendation).toHaveProperty("enum");
      expect(props.recommendation.enum).toEqual(["APPROVE", "MONITOR", "ESCALATE", "REJECT"]);
    });

    it("has all 5 risk dimension objects", () => {
      const dimensions = [
        "financial_health",
        "legal_regulatory",
        "cybersecurity",
        "leadership_governance",
        "esg_reputation",
      ];
      for (const dim of dimensions) {
        expect(jsonSchema.properties).toHaveProperty(dim);
      }
    });

    it("each risk dimension has status, findings, and severity", () => {
      const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
      const dimensions = [
        "financial_health",
        "legal_regulatory",
        "cybersecurity",
        "leadership_governance",
        "esg_reputation",
      ];
      for (const dim of dimensions) {
        const dimProps = (props[dim] as Record<string, unknown>).properties as Record<string, unknown>;
        expect(dimProps).toHaveProperty("status");
        expect(dimProps).toHaveProperty("findings");
        expect(dimProps).toHaveProperty("severity");
      }
    });

    it("has adverse_events as array", () => {
      const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
      expect(props.adverse_events.type).toBe("array");
      expect(props.adverse_events).toHaveProperty("items");
    });

    it("adverse_events items have required fields", () => {
      const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
      const items = props.adverse_events.items as Record<string, unknown>;
      const itemProps = items.properties as Record<string, unknown>;
      expect(itemProps).toHaveProperty("title");
      expect(itemProps).toHaveProperty("date");
      expect(itemProps).toHaveProperty("category");
      expect(itemProps).toHaveProperty("severity");
      expect(itemProps).toHaveProperty("description");
    });

    it("lists all required top-level fields", () => {
      const required = jsonSchema.required as string[];
      expect(required).toContain("vendor_name");
      expect(required).toContain("assessment_date");
      expect(required).toContain("overall_risk_level");
      expect(required).toContain("financial_health");
      expect(required).toContain("legal_regulatory");
      expect(required).toContain("cybersecurity");
      expect(required).toContain("leadership_governance");
      expect(required).toContain("esg_reputation");
      expect(required).toContain("adverse_events");
      expect(required).toContain("recommendation");
    });
  });
});
