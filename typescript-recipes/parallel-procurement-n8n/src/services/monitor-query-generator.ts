import {
  legacyCadenceToFrequency,
  pickProcessor,
  type MonitorProcessor,
} from "../models/monitor-api.js";
import type { RiskDimension, MonitorQuerySet } from "../models/monitor-query.js";
import type { Vendor, MonitoringPriority } from "../models/vendor.js";
import { escapeMonitorQueryVendorName } from "../workflows/generator-utils.js";

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

// V1 Monitor API frequencies: "1d" for daily, "7d" for weekly. High +
// medium vendors monitor daily; low vendors monitor weekly to keep cost
// down on the long tail.
interface PriorityConfig {
  dimensions: RiskDimension[];
  frequency: string;
}

const PRIORITY_CONFIG: Record<MonitoringPriority, PriorityConfig> = {
  high: {
    dimensions: ["legal", "cyber", "financial", "leadership", "esg"],
    frequency: legacyCadenceToFrequency("daily"),
  },
  medium: {
    dimensions: ["legal", "cyber", "financial"],
    frequency: legacyCadenceToFrequency("daily"),
  },
  low: {
    dimensions: ["legal", "financial"],
    frequency: legacyCadenceToFrequency("weekly"),
  },
};

// ── Generator ──────────────────────────────────────────────────────────────

export class MonitorQueryGenerator {
  generateQueries(vendor: Vendor): MonitorQuerySet[] {
    const config = PRIORITY_CONFIG[vendor.monitoring_priority];
    const allowedDimensions = new Set(config.dimensions);

    return QUERY_TEMPLATES.filter((t) =>
      allowedDimensions.has(t.risk_dimension),
    ).map((t) => {
      const processor: MonitorProcessor = pickProcessor(
        t.risk_dimension,
        vendor.monitoring_priority,
      );
      return {
        // Strip embedded quotes from the vendor name before interpolating
        // into the literal `"<name>"` template so a name like `Acme "AI"
        // Inc` doesn't unbalance the quote pair (finding 15).
        query: t.template.replace("{vendor_name}", escapeMonitorQueryVendorName(vendor.vendor_name)),
        risk_dimension: t.risk_dimension,
        frequency: config.frequency,
        processor,
        monitor_category: t.monitor_category,
      };
    });
  }
}
