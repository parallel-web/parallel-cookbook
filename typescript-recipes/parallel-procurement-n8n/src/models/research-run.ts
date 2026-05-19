import type { RiskTier, Vendor } from "./vendor.js";
import type {
  BasisEntry,
  DeepResearchOutput,
  RiskAssessment,
} from "./risk-assessment.js";

// ── Batch Result ───────────────────────────────────────────────────────────

// `basis` carries the FieldBasis array returned alongside `content` by the
// Task API. Keeping it parallel to `results` lets the scorer / audit log
// surface per-field citations without re-fetching from Parallel.
export interface BatchResult {
  batch_index: number;
  taskgroup_id: string;
  results: Map<string, DeepResearchOutput>;
  basis: Map<string, BasisEntry[]>;
  run_ids: Map<string, string>;
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

// Every assessment writes one row. `top_citation_url` / `top_citation_title`
// / `confidence` come from Task API `output.basis` and let the audit trail
// answer "why is this vendor flagged?" with a source URL the moment the
// row is written. Stored alongside the existing categories + summary so
// the dashboard / Sheets row doesn't need to re-query Parallel.
export interface AuditLogEntry {
  timestamp: string;
  vendor_name: string;
  risk_level: RiskTier;
  adverse_flag: boolean;
  categories: string;
  summary: string;
  run_id: string;
  source: "deep_research" | "monitor_event" | "adhoc";
  top_citation_url?: string;
  top_citation_title?: string;
  confidence?: string;
}
