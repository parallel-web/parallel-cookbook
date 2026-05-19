import type { OutputSchema, VendorForResearch } from "./types";

const RISK_LEVEL_ENUM = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const RECOMMENDATION_ENUM = ["APPROVE", "MONITOR", "ESCALATE", "REJECT"];

const RISK_DIMENSION_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: RISK_LEVEL_ENUM },
    findings: { type: "string" },
    severity: { type: "string", enum: RISK_LEVEL_ENUM },
  },
  required: ["status", "findings", "severity"],
};

export const RESEARCH_OUTPUT_SCHEMA: OutputSchema = {
  type: "json",
  json_schema: {
    type: "object",
    properties: {
      vendor_name: { type: "string" },
      assessment_date: { type: "string" },
      overall_risk_level: { type: "string", enum: RISK_LEVEL_ENUM },
      financial_health: RISK_DIMENSION_SCHEMA,
      legal_regulatory: RISK_DIMENSION_SCHEMA,
      cybersecurity: RISK_DIMENSION_SCHEMA,
      leadership_governance: RISK_DIMENSION_SCHEMA,
      esg_reputation: RISK_DIMENSION_SCHEMA,
      adverse_events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            date: { type: "string" },
            category: { type: "string" },
            severity: { type: "string", enum: RISK_LEVEL_ENUM },
            source_url: { type: "string" },
            description: { type: "string" },
          },
          required: ["title", "date", "category", "severity", "description"],
        },
      },
      recommendation: { type: "string", enum: RECOMMENDATION_ENUM },
    },
    required: [
      "vendor_name",
      "assessment_date",
      "overall_risk_level",
      "financial_health",
      "legal_regulatory",
      "cybersecurity",
      "leadership_governance",
      "esg_reputation",
      "adverse_events",
      "recommendation",
    ],
  },
};

export function buildResearchPrompt(vendor: VendorForResearch): string {
  return `You are a vendor risk analyst conducting a comprehensive due diligence assessment of "${vendor.vendor_name}" (${vendor.vendor_domain}), a ${vendor.vendor_category} vendor.

Investigate the following six risk dimensions thoroughly. For each finding, classify its severity (LOW, MEDIUM, HIGH, CRITICAL) and include source URLs and dates where available.

1. FINANCIAL HEALTH — earnings, credit ratings, debt levels, funding rounds, revenue trends, distress signals, downgrades, defaults.
2. LEGAL & REGULATORY — active litigation, regulatory actions, SEC investigations, sanctions, OFAC, consent orders, enforcement.
3. OPERATIONAL RISK — outages, breaches, supply chain disruptions, complaints, BC/DR posture.
4. LEADERSHIP & GOVERNANCE — executive departures, CEO changes, board reshuffles, activist activity, M&A.
5. ESG & REPUTATION — environmental violations, labor disputes, workplace safety, negative press, controversies, recalls.
6. CYBERSECURITY POSTURE — vulnerabilities, breach history, certifications (SOC 2, ISO 27001), pen test disclosures, ransomware, vulnerability disclosures.

Provide a structured assessment with:
- An overall risk level (LOW, MEDIUM, HIGH, or CRITICAL)
- A status, findings summary, and severity for each risk dimension
- A list of specific adverse events with dates, sources, and severity
- A recommendation: APPROVE, MONITOR, ESCALATE, or REJECT

Be specific and cite real events, dates, and sources. Do not speculate or fabricate findings.`;
}
