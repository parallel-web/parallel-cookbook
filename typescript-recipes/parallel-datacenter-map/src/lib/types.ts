export interface Datacenter {
  name: string;
  operator: string;
  owner: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  yearOnline: string;
  powerMw: number;
  sqft: number;
  type: string;
  status: DatacenterStatus;
  region: string;
  enrichment?: DatacenterEnrichment;
  aiClassification?: AiClassification;
  /** Original row index in the source dataset — the key for enrichment,
   *  AI-classification, snapshot, and per-facility blob lookups. Survives
   *  dedup so those references stay valid after duplicate rows are collapsed. */
  sourceIndex?: number;
}

export type AiClass =
  | "ai-training"
  | "ai-inference"
  | "ai-mixed"
  | "cloud-hyperscale"
  | "not-ai";

export type ImpactLevel = "high" | "moderate" | "low" | "unknown";

export type CommunityPushback =
  | "active-opposition"
  | "some-concern"
  | "none-found";

export interface AiClassification {
  ai_class: AiClass;
  ai_evidence: string;
  water_impact: ImpactLevel;
  water_note: string;
  grid_impact: ImpactLevel;
  grid_note: string;
  community_pushback: CommunityPushback;
  community_note: string;
  citations?: { title: string; url: string }[];
  classifiedAt?: string;
  runId?: string;
}

export interface DatacenterEnrichment {
  // v1
  description: string;
  verified_status: string;
  power_capacity_mw: number;
  total_sqft: number;
  year_online: string;
  construction_update: string;
  recent_news: string;
  notable_tenants: string;
  // v2
  verified_name: string;
  verified_operator: string;
  verified_owner: string;
  cooling_type: string;
  tier_level: string;
  fiber_providers: string;
  num_buildings: number;
  campus_acres: number;
  utility_provider: string;
  tax_incentives: string;
  natural_hazard_zone: string;
  // metadata
  citations?: { field: string; url: string; title: string }[];
  reasoning?: Record<string, string>;
  enrichedAt?: string;
  runId?: string;
}

export type DatacenterStatus =
  | "operational"
  | "under-construction"
  | "planned"
  | "unknown"
  | "decommissioned";

export type DisplayStatus =
  | "operational"
  | "construction"
  | "planned"
  | "unknown"
  | "decommissioned";

export type EventCategory =
  | "POWER & GRID"
  | "OWNERSHIP"
  | "NEW SITE"
  | "PERMITS"
  | "EXPANSION"
  | "COMMUNITY"
  | "WATER"
  | "POLICY";

export interface MonitorEvent {
  id: string;
  monitorId: string;
  monitorName: string;
  category: EventCategory;
  facilityCode: string;
  timestamp: string;
  headline: string;
  description: string;
  sources: { label: string; url: string }[];
  confidence?: number;
  hasTaskReport?: boolean;
  taskReportSummary?: string;
  region?: string;
  rawPayload?: unknown;
}

export type MonitorCategory =
  | "POWER_GRID"
  | "ZONING_POLICY"
  | "COMMUNITY"
  | "WATER"
  | "LAND_SUPPLY"
  | "TENANT_DEMAND"
  | "CAPITAL_OWNERSHIP"
  | "CONSTRUCTION";

export interface Monitor {
  id: string;
  monitorId: string;
  name: string;
  class: "region" | "facility" | "discovery";
  query: string;
  frequency: string;
  region?: string;
  facilityCode?: string;
  states?: string[];
  facilityCount: number;
  events: MonitorDetection[];
}

export interface MonitorDetection {
  eventId: string;
  eventDate: string;
  category: MonitorCategory;
  headline: string;
  summary: string;
  severity: "critical" | "notable" | "informational";
  affectedEntities: string;
  citations: { title: string; url: string; excerpts?: string[] }[];
  rawPayload?: unknown;
}

export interface MonitorConfig {
  id: string;
  monitorId?: string;
  name: string;
  class: "region" | "facility" | "discovery";
  query: string;
  frequency: string;
  processor: string;
  region?: string;
  facilityCode?: string;
}
