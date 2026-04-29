import type { MonitorCadence } from "../models/monitor-api.js";
import type { RiskDimension, MonitorQuerySet } from "../models/monitor-query.js";
import type { Vendor, MonitoringPriority } from "../models/vendor.js";

// ── Query Templates (PRD Section 4.2 Workflow 4) ──────────────────────────

interface QueryTemplate {
  risk_dimension: RiskDimension;
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

// ── Priority Configuration (PRD Section 6.1) ──────────────────────────────

interface PriorityConfig {
  dimensions: RiskDimension[];
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

// ── Generator ──────────────────────────────────────────────────────────────

export class MonitorQueryGenerator {
  generateQueries(vendor: Vendor): MonitorQuerySet[] {
    const config = PRIORITY_CONFIG[vendor.monitoring_priority];
    const allowedDimensions = new Set(config.dimensions);

    return QUERY_TEMPLATES.filter((t) => allowedDimensions.has(t.risk_dimension)).map(
      (t) => ({
        query: t.template.replace("{vendor_name}", vendor.vendor_name),
        risk_dimension: t.risk_dimension,
        cadence: config.cadence,
        monitor_category: t.monitor_category,
      }),
    );
  }
}
