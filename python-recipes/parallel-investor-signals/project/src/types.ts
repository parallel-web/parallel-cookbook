// Shared response contract — mirrors exactly what the FastAPI backend returns
// from POST /api/enrich (see backend/parallel_client.py -> to_research_brief).
// The frontend never talks to Parallel directly; it consumes this shape only.

export type Confidence = "high" | "medium" | "low" | "inferred";

export interface Citation {
  url: string;
  excerpts: string[];
}

// Every enriched value is a "cited claim": the value plus the evidence behind
// it. value===null means we found no supporting citation — we render that as
// "not found" rather than fabricating a claim.
export interface Field<T> {
  value: T | null;
  confidence: Confidence | null;
  citations: Citation[];
}

export interface Firmographics {
  industry: Field<string>;
  hq: Field<string>;
  employee_count: Field<string>;
  founded_year: Field<string>;
  description: Field<string>;
}

export interface Funding {
  total_raised: Field<string>;
  last_round: Field<string>;
  investors: Field<string[]>;
  valuation: Field<string>;
  revenue_estimate: Field<string>;
}

export interface Technographics {
  tech_stack: Field<string[]>;
}

export interface BuyingSignal {
  headline: string;
  type: string;
  date: string | null;
}

export interface ContactMethod {
  type: "email" | "phone";
  value: string;
}

export interface Contact {
  name: Field<string>;
  title: Field<string>;
  seniority: Field<string>;
  linkedin_url: Field<string>;
  // Up to 3 total, ordered highest to lowest confidence, sourced from
  // ZoomInfo/RocketReach/verified databases where possible. Only if
  // citation-backed, else value=null.
  contact_methods: Field<ContactMethod[]>;
  inferred_email: Field<string>; // pattern-derived, confidence always "inferred"
}

export interface BriefMeta {
  processor: string;
  run_ids: string[];
  latency_ms: number;
  partial: boolean;
}

// --- Custom research fields (ask-bar questions / bulk custom columns) ---
// Every answer is a cited string, gated by the same credibility rule as the
// built-in fields.

// What the client sends: a question. `key` is server-derived.
export interface CustomFieldDef {
  key?: string;
  label: string;
  question: string;
}

// What the backend returns per requested field.
export interface CustomFieldResult {
  key: string;
  label: string;
  question: string;
  field: Field<string>; // cited string, or value=null when uncited/not found
}

export interface ResearchBrief {
  query: string;
  company_name: string;
  domain: string | null;
  firmographics: Firmographics;
  funding: Funding;
  technographics: Technographics;
  buying_signals: Field<BuyingSignal[]>;
  contacts: Contact[];
  custom_fields?: CustomFieldResult[]; // present when custom fields were requested
  meta: BriefMeta;
  error?: string; // present on a per-row bulk failure
}

export type Depth = "fast" | "deep";

// --- Investor-monitoring signals (repo-root monitor/ pipeline) ---
export interface Signal {
  company: string;
  domain?: string;
  round_stage?: string;
  amount?: string;
  amount_usd_millions?: number;
  announced_date?: string;
  lead_investor?: string;
  co_investors?: string;
  investors?: string;
  investing_partner?: string; // partner at the watched fund — the intro path
  founders?: string;
  sector?: string;
  one_liner?: string;
  summary?: string;
  is_ai_native?: string;
  parallel_fit_rating?: number; // auto fit rating 1-10 (rubric in monitor/config.py)
  fit_reasoning?: string;
  priority?: "high" | "medium" | "digest";
  pipeline_label?: string; // live-CRM-backed when available, local fallback text
  crm_url?: string; // deep link to the CRM company record
  fund_watched: string;
  known_portco: boolean;
  sources: string[];
  detected_via: "sweep" | "monitor";
  detected_at: string;
  event_id?: string;
}

export interface SignalsResponse {
  available: boolean;
  // "verified": local mode — chain-verified signals from monitor/signals.json.
  // "live": serverless — raw monitor events fetched from Parallel per request.
  mode?: "verified" | "live";
  signals: Signal[];
  monitors: { fund: string; monitor_id: string }[];
}

// --- Bulk job shapes ---
export interface BulkRowStatus {
  company: string;
  status: "pending" | "running" | "done" | "error";
  brief?: ResearchBrief;
  error?: string;
}

export interface BulkJob {
  job_id: string;
  status: "running" | "done" | "error";
  done: number;
  total: number;
  results: ResearchBrief[];
}
