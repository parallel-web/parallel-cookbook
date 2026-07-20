// A realistic sample brief so the UI can be built and demoed even before the
// live backend is wired (and as a safe fallback if you flip DEMO_MOCK on).
// This is NOT used when the backend responds — it's a scaffold aid only.
import type { ResearchBrief } from "../types";

const cite = (url: string, ...excerpts: string[]) => ({ url, excerpts });

export const MOCK_BRIEF: ResearchBrief = {
  query: "ramp.com",
  company_name: "Ramp",
  domain: "ramp.com",
  firmographics: {
    industry: {
      value: "Financial technology — corporate cards & spend management",
      confidence: "high",
      citations: [
        cite(
          "https://ramp.com/about",
          "Ramp is the finance automation platform designed to save businesses time and money.",
        ),
      ],
    },
    hq: {
      value: "New York, NY",
      confidence: "high",
      citations: [cite("https://www.crunchbase.com/organization/ramp", "Headquarters: New York, New York")],
    },
    employee_count: {
      value: "1,000–1,500",
      confidence: "medium",
      citations: [cite("https://www.linkedin.com/company/ramp", "1,001-5,000 employees on LinkedIn")],
    },
    founded_year: {
      value: "2019",
      confidence: "high",
      citations: [cite("https://en.wikipedia.org/wiki/Ramp_(company)", "Ramp was founded in 2019 by Eric Glyman and Karim Atiyeh.")],
    },
    description: {
      value:
        "Ramp offers corporate cards, expense management, bill pay, and accounting automation aimed at helping finance teams control spend and close books faster.",
      confidence: "high",
      citations: [cite("https://ramp.com", "Corporate cards, bill payments, accounting, and more.")],
    },
  },
  funding: {
    total_raised: {
      value: "$1.9B+ (equity + debt)",
      confidence: "high",
      citations: [cite("https://techcrunch.com/2024/04/ramp-series-d", "Ramp has raised more than $1.9 billion in equity and debt.")],
    },
    last_round: {
      value: "Series D-2 — $150M (Apr 2024)",
      confidence: "high",
      citations: [cite("https://techcrunch.com/2024/04/ramp-series-d", "The $150 million round valued the company at $7.65 billion.")],
    },
    investors: {
      value: ["Founders Fund", "Thrive Capital", "Khosla Ventures", "Sequoia Capital"],
      confidence: "high",
      citations: [cite("https://www.crunchbase.com/organization/ramp/investors", "Lead investors include Founders Fund, Thrive Capital, and Khosla Ventures.")],
    },
    valuation: {
      value: "$7.65B (Apr 2024)",
      confidence: "high",
      citations: [cite("https://techcrunch.com/2024/04/ramp-series-d", "valued the company at $7.65 billion")],
    },
    revenue_estimate: {
      value: "~$300M annualized (2024, est.)",
      confidence: "low",
      citations: [cite("https://www.theinformation.com/ramp-revenue", "Sources estimate Ramp's annualized revenue at roughly $300 million.")],
    },
  },
  technographics: {
    tech_stack: {
      value: ["React", "TypeScript", "Python", "AWS", "Segment", "Datadog", "Stripe"],
      confidence: "medium",
      citations: [
        cite("https://stackshare.io/ramp", "Ramp's stack includes React, TypeScript, Python, and AWS."),
        cite("https://ramp.com/blog/engineering", "We rely on Datadog for observability."),
      ],
    },
  },
  buying_signals: {
    value: [
      { headline: "Ramp launches AI-powered agents for finance teams", type: "Product launch", date: "2024-10-01" },
      { headline: "Hiring surge: 40+ open engineering roles in NY & SF", type: "Hiring", date: "2024-09-15" },
      { headline: "Raised $150M Series D-2 at $7.65B valuation", type: "Funding", date: "2024-04-15" },
    ],
    confidence: "medium",
    citations: [
      cite("https://ramp.com/blog/ai-agents", "Today we're launching AI agents that automate expense workflows."),
      cite("https://ramp.com/careers", "40+ open engineering positions across New York and San Francisco."),
    ],
  },
  contacts: [
    {
      name: { value: "Eric Glyman", confidence: "high", citations: [cite("https://ramp.com/team", "Eric Glyman, Co-founder & CEO")] },
      title: { value: "Co-founder & CEO", confidence: "high", citations: [cite("https://ramp.com/team", "Eric Glyman, Co-founder & CEO")] },
      seniority: { value: "C-Suite", confidence: "high", citations: [] },
      linkedin_url: { value: "https://www.linkedin.com/in/ericglyman", confidence: "high", citations: [cite("https://www.linkedin.com/in/ericglyman", "Eric Glyman — CEO at Ramp")] },
      contact_methods: {
        value: [
          { type: "email", value: "eric@ramp.com" },
          { type: "phone", value: "+1-212-555-0148" },
        ],
        confidence: "high",
        citations: [cite("https://www.zoominfo.com/p/Eric-Glyman/mock", "Eric Glyman — Ramp — verified contact record")],
      },
      inferred_email: { value: "eric.glyman@ramp.com", confidence: "inferred", citations: [] },
    },
    {
      name: { value: "Karim Atiyeh", confidence: "high", citations: [cite("https://ramp.com/team", "Karim Atiyeh, Co-founder & CTO")] },
      title: { value: "Co-founder & CTO", confidence: "high", citations: [cite("https://ramp.com/team", "Karim Atiyeh, Co-founder & CTO")] },
      seniority: { value: "C-Suite", confidence: "high", citations: [] },
      linkedin_url: { value: "https://www.linkedin.com/in/karimatiyeh", confidence: "medium", citations: [cite("https://www.linkedin.com/in/karimatiyeh", "Karim Atiyeh — CTO at Ramp")] },
      contact_methods: { value: null, confidence: null, citations: [] },
      inferred_email: { value: "karim.atiyeh@ramp.com", confidence: "inferred", citations: [] },
    },
  ],
  meta: {
    processor: "core-fast",
    run_ids: ["trun_mock_account", "trun_mock_contacts"],
    latency_ms: 12480,
    partial: false,
  },
};
