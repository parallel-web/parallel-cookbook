import {
  cadenceToFrequency,
  pickMonitorProcessor,
  type MonitorCadence,
  type MonitorFrequency,
  type MonitorProcessor,
  type MonitoringPriority,
  type RiskDimensionKey,
  type VendorForResearch,
} from "./types";

// Mirror of escapeMonitorQueryVendorName in src/workflows/generator-utils.ts.
// A name like `Acme "AI" Inc` would otherwise produce an unterminated
// quote in the rendered query, e.g.
//   `"Acme "AI" Inc" lawsuit OR ...`
// which Parallel Search treats as malformed. We collapse embedded `"` to
// `'` and trim repeat whitespace (finding 15).
export function escapeMonitorQueryVendorName(name: string): string {
  return String(name ?? "")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MonitorQuerySet {
  query: string;
  risk_dimension: RiskDimensionKey;
  /** Legacy "daily"/"weekly" label retained for the Supabase row. */
  cadence: MonitorCadence;
  /** V1 frequency string ("1d", "7d") passed to client.monitor.create. */
  frequency: MonitorFrequency;
  /** V1 processor tier — `base` on high-priority cyber/legal only. */
  processor: MonitorProcessor;
  monitor_category: string;
}

interface QueryTemplate {
  risk_dimension: RiskDimensionKey;
  monitor_category: string;
  template: string;
}

const QUERY_TEMPLATES: QueryTemplate[] = [
  {
    risk_dimension: "legal",
    monitor_category: "Legal & Regulatory",
    template:
      '"{vendor_name}" lawsuit OR litigation OR regulatory action OR SEC investigation OR enforcement',
  },
  {
    risk_dimension: "cyber",
    monitor_category: "Cybersecurity",
    template:
      '"{vendor_name}" data breach OR cybersecurity incident OR ransomware OR vulnerability disclosure',
  },
  {
    risk_dimension: "financial",
    monitor_category: "Financial Health",
    template:
      '"{vendor_name}" bankruptcy OR financial distress OR credit downgrade OR debt default OR layoffs',
  },
  {
    risk_dimension: "leadership",
    monitor_category: "Leadership & Governance",
    template:
      '"{vendor_name}" CEO departure OR executive change OR acquisition OR merger OR leadership',
  },
  {
    risk_dimension: "esg",
    monitor_category: "ESG & Reputation",
    template:
      '"{vendor_name}" recall OR safety violation OR environmental fine OR labor dispute OR ESG controversy',
  },
];

interface PriorityConfig {
  dimensions: RiskDimensionKey[];
  cadence: MonitorCadence;
}

const PRIORITY_CONFIG: Record<MonitoringPriority, PriorityConfig> = {
  high: {
    dimensions: ["legal", "cyber", "financial", "leadership", "esg"],
    cadence: "daily",
  },
  medium: {
    dimensions: ["legal", "cyber", "financial"],
    cadence: "daily",
  },
  low: {
    dimensions: ["legal", "financial"],
    cadence: "weekly",
  },
};

export const MONITOR_OUTPUT_SCHEMA = {
  type: "json",
  json_schema: {
    type: "object",
    properties: {
      event_summary: { type: "string" },
      severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
      adverse: { type: "boolean" },
      event_type: { type: "string" },
    },
    required: ["event_summary", "severity", "adverse", "event_type"],
  },
} as const;

export function generateMonitorQueries(vendor: VendorForResearch): MonitorQuerySet[] {
  const config = PRIORITY_CONFIG[vendor.monitoring_priority];
  const allowed = new Set<RiskDimensionKey>(config.dimensions);
  const safeName = escapeMonitorQueryVendorName(vendor.vendor_name);
  return QUERY_TEMPLATES.filter((t) => allowed.has(t.risk_dimension)).map((t) => ({
    query: t.template.replace("{vendor_name}", safeName),
    risk_dimension: t.risk_dimension,
    cadence: config.cadence,
    frequency: cadenceToFrequency(config.cadence),
    processor: pickMonitorProcessor(t.risk_dimension, vendor.monitoring_priority),
    monitor_category: t.monitor_category,
  }));
}
