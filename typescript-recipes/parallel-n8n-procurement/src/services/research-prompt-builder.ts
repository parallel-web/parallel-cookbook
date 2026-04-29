import type { OutputSchema } from "../models/task-api.js";
import type { Vendor } from "../models/vendor.js";

// ── Output Schema (PRD Section 5.1) ───────────────────────────────────────

const RISK_LEVEL_ENUM = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const RECOMMENDATION_ENUM = ["APPROVE", "MONITOR", "ESCALATE", "REJECT"];

const RISK_DIMENSION_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: RISK_LEVEL_ENUM,
      description: "Risk level for this dimension",
    },
    findings: {
      type: "string",
      description: "Summary of key findings for this dimension",
    },
    severity: {
      type: "string",
      enum: RISK_LEVEL_ENUM,
      description: "Severity of the most critical finding",
    },
  },
  required: ["status", "findings", "severity"],
};

const RESEARCH_OUTPUT_SCHEMA: OutputSchema = {
  type: "json",
  json_schema: {
    type: "object",
    properties: {
      vendor_name: { type: "string", description: "Name of the vendor assessed" },
      assessment_date: {
        type: "string",
        description: "ISO date of the assessment (YYYY-MM-DD)",
      },
      overall_risk_level: {
        type: "string",
        enum: RISK_LEVEL_ENUM,
        description: "Aggregate risk level across all dimensions",
      },
      financial_health: {
        ...RISK_DIMENSION_SCHEMA,
        description: "Financial health assessment: earnings, credit ratings, debt, funding",
      },
      legal_regulatory: {
        ...RISK_DIMENSION_SCHEMA,
        description: "Legal and regulatory risk: litigation, sanctions, compliance",
      },
      cybersecurity: {
        ...RISK_DIMENSION_SCHEMA,
        description: "Cybersecurity posture: vulnerabilities, breach history, certifications",
      },
      leadership_governance: {
        ...RISK_DIMENSION_SCHEMA,
        description: "Leadership and governance: executive changes, board stability, M&A",
      },
      esg_reputation: {
        ...RISK_DIMENSION_SCHEMA,
        description: "ESG and reputational risk: environmental, labor, public perception",
      },
      adverse_events: {
        type: "array",
        description: "List of adverse events discovered during research",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Event headline" },
            date: { type: "string", description: "Event date (YYYY-MM-DD or approximate)" },
            category: {
              type: "string",
              description: "Event category (financial, legal, cyber, leadership, esg, operational)",
            },
            severity: { type: "string", enum: RISK_LEVEL_ENUM },
            source_url: { type: "string", description: "URL of the source" },
            description: { type: "string", description: "Brief description of the event" },
          },
          required: ["title", "date", "category", "severity", "description"],
        },
      },
      recommendation: {
        type: "string",
        enum: RECOMMENDATION_ENUM,
        description: "Recommended action based on the assessment",
      },
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

// ── Prompt Builder ─────────────────────────────────────────────────────────

export class ResearchPromptBuilder {
  buildPrompt(vendor: Vendor): string {
    return `You are a vendor risk analyst conducting a comprehensive due diligence assessment of "${vendor.vendor_name}" (${vendor.vendor_domain}), a ${vendor.vendor_category} vendor.

Investigate the following six risk dimensions thoroughly. For each finding, classify its severity (LOW, MEDIUM, HIGH, CRITICAL) and include source URLs and dates where available.

1. FINANCIAL HEALTH
   Research earnings reports, credit ratings, debt levels, funding rounds, revenue trends, and any signs of financial distress. Check for bankruptcy filings, credit downgrades, and debt defaults.

2. LEGAL & REGULATORY
   Investigate active litigation, regulatory actions, SEC investigations, sanctions exposure, OFAC listings, and compliance violations. Check for class action lawsuits, consent orders, and enforcement actions.

3. OPERATIONAL RISK
   Examine service outages, data breaches, supply chain disruptions, client complaints, and operational incidents. Assess business continuity and disaster recovery posture.

4. LEADERSHIP & GOVERNANCE
   Research executive departures, CEO changes, board reshuffles, activist investor activity, and M&A activity. Assess management stability and governance quality.

5. ESG & REPUTATION
   Investigate environmental violations, labor disputes, workplace safety issues, negative press coverage, social media controversies, and ESG rating changes. Check for recalls and consumer protection actions.

6. CYBERSECURITY POSTURE
   Research known vulnerabilities, breach history, security certifications (SOC 2, ISO 27001), penetration test disclosures, and data protection practices. Check for ransomware incidents and vulnerability disclosures.

Provide a structured assessment with:
- An overall risk level (LOW, MEDIUM, HIGH, or CRITICAL)
- A status, findings summary, and severity for each risk dimension
- A list of specific adverse events with dates, sources, and severity
- A recommendation: APPROVE (low risk), MONITOR (moderate risk requiring ongoing attention), ESCALATE (high risk requiring immediate review), or REJECT (unacceptable risk)

Be specific and cite real events, dates, and sources. Do not speculate or fabricate findings.`;
  }

  getOutputSchema(): OutputSchema {
    return RESEARCH_OUTPUT_SCHEMA;
  }
}
