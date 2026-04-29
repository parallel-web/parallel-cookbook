import type { RiskTier, Vendor } from "./vendor.js";
import type { DeepResearchOutput, RiskAssessment } from "./risk-assessment.js";

// ── Batch Result ───────────────────────────────────────────────────────────

export interface BatchResult {
  batch_index: number;
  taskgroup_id: string;
  results: Map<string, DeepResearchOutput>;
  failures: Array<{ vendor_domain: string; run_id: string; error: string }>;
}

// ── Processed Results ──────────────────────────────────────────────────────

export interface ProcessedResults {
  assessments: Array<{ vendor: Vendor; assessment: RiskAssessment }>;
  errors: Array<{ vendor_domain: string; error: string }>;
}

// ── Research Run Summary ───────────────────────────────────────────────────

export interface ResearchRunSummary {
  total_due: number;
  total_researched: number;
  total_failed: number;
  risk_counts: Record<RiskTier, number>;
  adverse_count: number;
  batches_executed: number;
  duration_ms: number;
}

// ── Audit Log Entry ────────────────────────────────────────────────────────

export interface AuditLogEntry {
  timestamp: string;
  vendor_name: string;
  risk_level: RiskTier;
  adverse_flag: boolean;
  categories: string;
  summary: string;
  run_id: string;
  source: "deep_research" | "monitor_event";
}
