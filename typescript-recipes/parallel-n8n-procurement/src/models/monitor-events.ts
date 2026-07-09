import type { RiskTier } from "./vendor.js";
import type { RiskAssessment } from "./risk-assessment.js";

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
  // Raw event fields
  event_id?: string;
  event_group_id: string;
  monitor_id: string;
  event_date?: string;
  source_urls?: string[];

  // Vendor context
  vendor_name: string;
  vendor_domain: string;
  risk_dimension: string;
  monitoring_priority: string;
  monitor_category: string;

  // Parsed output (Section 5.3)
  event_summary: string;
  severity: RiskTier;
  adverse: boolean;
  event_type: string;
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
