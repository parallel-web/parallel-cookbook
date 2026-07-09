// Lightweight TypeScript types for the Parallel API surface used by the
// dashboard. Mirrors the relevant zod schemas in
// n8n-procurement/src/models/* without bringing zod into the Next.js bundle.
// Updated for Monitor API V1 (event_stream / snapshot types, settings
// wrapper, processor tier, cancelled spelling) and Task API basis
// plumbing.

export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type MonitoringPriority = "high" | "medium" | "low";
/**
 * Legacy "daily" / "weekly" labels are preserved at the storage layer
 * (Supabase `monitors.cadence`) so existing rows keep rendering. The V1
 * Monitor API uses a free-form frequency string like "1d" / "7d" / "12h",
 * exposed via {@link MonitorFrequency} below.
 */
export type MonitorCadence = "daily" | "weekly";
export type MonitorFrequency = string;
export type MonitorProcessor = "lite" | "base";
export type RiskDimensionKey = "legal" | "cyber" | "financial" | "leadership" | "esg";

export type Recommendation =
  | "continue_monitoring"
  | "escalate_review"
  | "initiate_contingency"
  | "suspend_relationship";

export interface RiskDimensionOutput {
  status: string;
  findings: string;
  severity: RiskTier;
}

export interface AdverseEvent {
  title: string;
  date: string;
  category: string;
  severity: RiskTier;
  source_url?: string;
  description: string;
}

export interface DeepResearchOutput {
  vendor_name: string;
  assessment_date: string;
  overall_risk_level: RiskTier;
  financial_health: RiskDimensionOutput;
  legal_regulatory: RiskDimensionOutput;
  cybersecurity: RiskDimensionOutput;
  leadership_governance: RiskDimensionOutput;
  esg_reputation: RiskDimensionOutput;
  adverse_events: AdverseEvent[];
  recommendation: string;
}

export interface MonitorEventOutput {
  event_summary: string;
  severity: RiskTier;
  adverse: boolean;
  event_type: string;
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

// ── Task API basis (citations + reasoning + confidence) ─────────────────

export interface BasisCitation {
  url: string;
  title?: string | null;
  excerpts?: string[] | null;
}

export interface BasisEntry {
  field: string;
  reasoning?: string | null;
  citations?: BasisCitation[];
  confidence?: string | null;
}

export interface TopCitation {
  dimension: string;
  url: string;
  title?: string;
  reasoning?: string;
  confidence?: string;
}

export interface RiskAssessment {
  risk_level: RiskTier;
  adverse_flag: boolean;
  risk_categories: string[];
  summary: string;
  action_required: boolean;
  recommendation: Recommendation;
  severity_counts: SeverityCounts;
  triggered_overrides: string[];
  basis_per_dimension?: Record<string, BasisEntry[]>;
  top_citations?: TopCitation[];
}

export interface VendorOverrides {
  risk_tier_override?: RiskTier;
}

export interface VendorContext {
  vendor_name: string;
  vendor_domain: string;
  monitoring_priority: string;
}

export interface VendorForResearch {
  vendor_name: string;
  vendor_domain: string;
  vendor_category: string;
  monitoring_priority: MonitoringPriority;
}

// ── Task API ──

export type TaskRunStatus =
  | "queued"
  | "action_required"
  | "running"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled";

export interface OutputSchema {
  type: "text" | "json";
  json_schema?: Record<string, unknown>;
}

export interface WebhookConfig {
  url: string;
  events?: string[];
}

export interface CreateRunParams {
  input: string | Record<string, unknown>;
  processor?: string;
  outputSchema?: OutputSchema;
  webhook?: WebhookConfig;
  metadata?: Record<string, string>;
}

export interface TaskRun {
  run_id: string;
  status: TaskRunStatus;
  is_active?: boolean;
  error?: string | { message: string } | null;
}

// V1 Task output now always carries `basis` (FieldBasis[]).
export interface TaskRunOutput {
  type: "text" | "json";
  content: string | Record<string, unknown>;
  basis?: BasisEntry[];
}

export interface TaskRunResult {
  output: TaskRunOutput;
  run?: TaskRun;
}

export interface TaskGroup {
  taskgroup_id: string;
}

export interface TaskGroupStatus {
  taskgroup_id: string;
  status: {
    is_active: boolean;
    num_task_runs: number;
    task_run_status_counts: Record<string, number>;
  };
}

export interface TaskGroupRun {
  run_id: string;
  status: TaskRunStatus;
  output?: TaskRunOutput;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type TaskGroupResults = TaskGroupRun[];

export interface TaskRunInput {
  input: string | Record<string, unknown>;
  processor?: string;
  metadata?: Record<string, string>;
  webhook?: WebhookConfig;
}

// ── Monitor API V1 ──────────────────────────────────────────────────────

export type MonitorStatus = "active" | "cancelled";
export type MonitorType = "event_stream" | "snapshot";

export interface MonitorWebhook {
  url: string;
  event_types?: Array<
    | "monitor.event.detected"
    | "monitor.execution.completed"
    | "monitor.execution.failed"
  >;
}

export interface MonitorMetadata {
  vendor_name: string;
  vendor_domain: string;
  monitor_category: string;
  risk_dimension: string;
  [key: string]: string;
}

export interface SourcePolicy {
  after_date?: string | null;
  include_domains?: string[];
  exclude_domains?: string[];
}

export interface AdvancedMonitorSettings {
  location?: string | null;
  source_policy?: SourcePolicy | null;
}

export interface MonitorEventStreamSettings {
  query: string;
  output_schema?: { type: "json"; json_schema: Record<string, unknown> } | Record<string, unknown> | null;
  include_backfill?: boolean | null;
  advanced_settings?: AdvancedMonitorSettings | null;
}

export interface MonitorCreateInput {
  type: MonitorType;
  frequency: MonitorFrequency;
  processor?: MonitorProcessor;
  settings: MonitorEventStreamSettings;
  webhook?: MonitorWebhook;
  metadata?: Record<string, string>;
}

export interface Monitor {
  monitor_id: string;
  type: MonitorType;
  frequency: MonitorFrequency;
  processor: MonitorProcessor;
  status: MonitorStatus;
  settings: MonitorEventStreamSettings;
  webhook?: MonitorWebhook | null;
  metadata?: Record<string, string> | null;
  created_at: string;
  last_run_at?: string | null;
}

// V1 events: stable id, typed output with basis, no more top-level
// source_urls.
export interface MonitorEventStreamEvent {
  event_id: string;
  event_group_id: string;
  event_date: string | null;
  output: TaskRunOutput;
  event_type?: "event_stream";
}

export interface MonitorCompletionEvent {
  timestamp: string;
  event_type?: "completion";
}

export interface MonitorErrorEvent {
  error_message: string;
  timestamp: string;
  event_type?: "error";
}

export type MonitorEvent =
  | MonitorEventStreamEvent
  | MonitorCompletionEvent
  | MonitorErrorEvent;

export interface PaginatedMonitorEvents {
  events: MonitorEvent[];
  next_cursor?: string | null;
}

export interface MonitorListInput {
  cursor?: string;
  limit?: number;
  status?: MonitorStatus[];
  type?: MonitorType[];
}

export interface MonitorEventsInput {
  cursor?: string;
  event_group_id?: string;
  include_completions?: boolean;
  limit?: number;
}

export class ParallelApiError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string = "") {
    super(message);
    this.name = "ParallelApiError";
    this.status = status;
    this.body = body;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

export function cadenceToFrequency(cadence: MonitorCadence): MonitorFrequency {
  return cadence === "daily" ? "1d" : "7d";
}

export function pickMonitorProcessor(
  riskDimension: string,
  priority: string,
): MonitorProcessor {
  return priority === "high" && (riskDimension === "cyber" || riskDimension === "legal")
    ? "base"
    : "lite";
}
