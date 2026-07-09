import type { RiskTier } from "./vendor.js";
import type { BasisEntry, RiskAssessment } from "./risk-assessment.js";

// ── Monitor Registry Context ───────────────────────────────────────────────

export interface MonitorRegistryContext {
  vendor_name: string;
  vendor_domain: string;
  risk_dimension: string;
  monitoring_priority: string;
  monitor_category: string;
}

// ── Enriched Event ─────────────────────────────────────────────────────────

export interface EnrichedEvent {
  // Raw event fields (V1 monitor event_stream shape)
  event_id: string;
  event_group_id: string;
  monitor_id: string;
  event_date: string | null;

  // Vendor context
  vendor_name: string;
  vendor_domain: string;
  risk_dimension: string;
  monitoring_priority: string;
  monitor_category: string;

  // Parsed output (PRD Section 5.3 flat schema)
  event_summary: string;
  severity: RiskTier;
  adverse: boolean;
  event_type: string;

  // V1 basis — per-field citations + reasoning + confidence. URLs live at
  // basis[].citations[].url (replaces deprecated top-level source_urls).
  basis: BasisEntry[];
}

// ── Event Handler Result ───────────────────────────────────────────────────

export interface EventHandlerResult {
  processed: boolean;
  duplicate: boolean;
  assessment?: RiskAssessment;
  vendor_domain?: string;
  event_group_id: string;
  error?: string;
}
