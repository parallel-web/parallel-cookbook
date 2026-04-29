import { z } from "zod";
import { RiskTierSchema } from "./vendor.js";

// ── Risk Dimension (shared shape for research output) ──────────────────────

export const RiskDimensionOutputSchema = z.object({
  status: z.string(),
  findings: z.string(),
  severity: RiskTierSchema,
});

// ── Adverse Event ──────────────────────────────────────────────────────────

export const AdverseEventSchema = z.object({
  title: z.string(),
  date: z.string(),
  category: z.string(),
  severity: RiskTierSchema,
  source_url: z.string().optional(),
  description: z.string(),
});

// ── Deep Research Output (matches research-prompt-builder schema) ──────────

export const DeepResearchOutputSchema = z.object({
  vendor_name: z.string(),
  assessment_date: z.string(),
  overall_risk_level: RiskTierSchema,
  financial_health: RiskDimensionOutputSchema,
  legal_regulatory: RiskDimensionOutputSchema,
  cybersecurity: RiskDimensionOutputSchema,
  leadership_governance: RiskDimensionOutputSchema,
  esg_reputation: RiskDimensionOutputSchema,
  adverse_events: z.array(AdverseEventSchema),
  recommendation: z.string(),
});

// ── Monitor Event Output (Section 5.3) ─────────────────────────────────────

export const MonitorEventOutputSchema = z.object({
  event_summary: z.string(),
  severity: RiskTierSchema,
  adverse: z.boolean(),
  event_type: z.string(),
});

// ── Vendor Overrides (scoring inputs) ──────────────────────────────────────

export const VendorOverridesSchema = z.object({
  risk_tier_override: RiskTierSchema.optional(),
});

// ── Vendor Context (for monitor event scoring) ─────────────────────────────

export const VendorContextSchema = z.object({
  vendor_name: z.string(),
  vendor_domain: z.string(),
  monitoring_priority: z.string(),
});

// ── Severity Counts ────────────────────────────────────────────────────────

export const SeverityCountsSchema = z.object({
  critical: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
});

// ── Recommendation Enum ────────────────────────────────────────────────────

export const RecommendationSchema = z.enum([
  "continue_monitoring",
  "escalate_review",
  "initiate_contingency",
  "suspend_relationship",
]);

// ── Risk Assessment (scorer output) ────────────────────────────────────────

export const RiskAssessmentSchema = z.object({
  risk_level: RiskTierSchema,
  adverse_flag: z.boolean(),
  risk_categories: z.array(z.string()),
  summary: z.string(),
  action_required: z.boolean(),
  recommendation: RecommendationSchema,
  severity_counts: SeverityCountsSchema,
  triggered_overrides: z.array(z.string()),
});

// ── Derived TypeScript Types ───────────────────────────────────────────────

export type RiskDimensionOutput = z.infer<typeof RiskDimensionOutputSchema>;
export type AdverseEvent = z.infer<typeof AdverseEventSchema>;
export type DeepResearchOutput = z.infer<typeof DeepResearchOutputSchema>;
export type MonitorEventOutput = z.infer<typeof MonitorEventOutputSchema>;
export type VendorOverrides = z.infer<typeof VendorOverridesSchema>;
export type VendorContext = z.infer<typeof VendorContextSchema>;
export type SeverityCounts = z.infer<typeof SeverityCountsSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
