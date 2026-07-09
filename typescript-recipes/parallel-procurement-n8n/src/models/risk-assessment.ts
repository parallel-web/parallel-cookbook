import { z } from "zod";
import { RiskTierSchema, type RiskTier } from "./vendor.js";
import { BasisCitationSchema, BasisEntrySchema } from "./task-api.js";

// ── Severity normalization ─────────────────────────────────────────────────
//
// The Parallel Monitor schema constrains `severity` to LOW/MEDIUM/HIGH/CRITICAL
// at the Task layer, but a monitor that emits text output (or a misconfigured
// schema) can still ship values like "INFO", "" or null. We collapse anything
// off-enum to "LOW" so downstream lookups into RECOMMENDATION_MAP and the
// SeverityCounts bucket are always defined (matches dashboard/lib/parallel/
// severity.ts and the parallel-monitor webhook route).

const RISK_TIER_SET = new Set<RiskTier>(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export function normalizeSeverity(value: unknown): RiskTier {
  if (typeof value !== "string") return "LOW";
  const upper = value.trim().toUpperCase();
  return RISK_TIER_SET.has(upper as RiskTier) ? (upper as RiskTier) : "LOW";
}

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

// Per-dimension grouping of FieldBasis entries (citations + reasoning +
// confidence) lifted from Task API `output.basis`. Lets the audit log and
// Slack alerts answer "why is this vendor flagged?" with source URLs.
export const TopCitationSchema = z.object({
  dimension: z.string(),
  url: z.string(),
  title: z.string().nullish(),
  reasoning: z.string().nullish(),
  confidence: z.string().nullish(),
});

export const RiskAssessmentSchema = z.object({
  risk_level: RiskTierSchema,
  adverse_flag: z.boolean(),
  risk_categories: z.array(z.string()),
  summary: z.string(),
  action_required: z.boolean(),
  recommendation: RecommendationSchema,
  severity_counts: SeverityCountsSchema,
  triggered_overrides: z.array(z.string()),
  // Basis plumbing — optional so legacy callers still typecheck. Populated by
  // RiskScorer when Task API basis is available.
  basis_per_dimension: z.record(z.array(BasisEntrySchema)).optional(),
  top_citations: z.array(TopCitationSchema).optional(),
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
export type TopCitation = z.infer<typeof TopCitationSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
export type BasisCitation = z.infer<typeof BasisCitationSchema>;
export type BasisEntry = z.infer<typeof BasisEntrySchema>;
