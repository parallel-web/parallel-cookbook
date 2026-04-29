import type { ParallelMonitorClient } from "./parallel-monitor-client.js";
import type { MonitorQueryGenerator } from "./monitor-query-generator.js";
import type { MonitorWebhook } from "../models/monitor-api.js";
import type { Vendor } from "../models/vendor.js";
import type {
  MonitorRegistryEntry,
  ReconcileResult,
} from "../models/monitor-query.js";

// ── PRD Section 5.3 Output Schema ─────────────────────────────────────────

const MONITOR_OUTPUT_SCHEMA = {
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
};

// ── Options ────────────────────────────────────────────────────────────────

export interface MonitorPortfolioManagerOptions {
  monitorClient: ParallelMonitorClient;
  queryGenerator: MonitorQueryGenerator;
  webhook?: MonitorWebhook;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Manager ────────────────────────────────────────────────────────────────

export class MonitorPortfolioManager {
  private readonly monitorClient: ParallelMonitorClient;
  private readonly queryGenerator: MonitorQueryGenerator;
  private readonly webhook?: MonitorWebhook;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  constructor(options: MonitorPortfolioManagerOptions) {
    this.monitorClient = options.monitorClient;
    this.queryGenerator = options.queryGenerator;
    this.webhook = options.webhook;
    this.log = options.logger ?? console;
  }

  // ── Reconciliation (pure, no API calls) ────────────────────────────────

  reconcileMonitors(
    currentVendors: Vendor[],
    registeredMonitors: MonitorRegistryEntry[],
  ): ReconcileResult {
    const activeVendors = currentVendors.filter((v) => v.active);
    const activeDomains = new Set(activeVendors.map((v) => v.vendor_domain));

    // Group registered monitors by vendor_domain
    const registeredByDomain = new Map<string, string[]>();
    for (const entry of registeredMonitors) {
      const ids = registeredByDomain.get(entry.vendor_domain) ?? [];
      ids.push(entry.monitor_id);
      registeredByDomain.set(entry.vendor_domain, ids);
    }
    const registeredDomains = new Set(registeredByDomain.keys());

    const to_create = activeVendors
      .filter((v) => !registeredDomains.has(v.vendor_domain))
      .map((vendor) => ({
        vendor,
        queries: this.queryGenerator.generateQueries(vendor),
      }));

    const to_delete: ReconcileResult["to_delete"] = [];
    for (const [domain, monitorIds] of registeredByDomain) {
      if (!activeDomains.has(domain)) {
        to_delete.push({ vendor_domain: domain, monitor_ids: monitorIds });
      }
    }

    const unchanged = [...activeDomains]
      .filter((d) => registeredDomains.has(d))
      .map((vendor_domain) => ({ vendor_domain }));

    return { to_create, to_delete, unchanged };
  }

  // ── Deploy monitors for vendors ────────────────────────────────────────

  async deployMonitors(
    vendors: Vendor[],
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();

    for (const vendor of vendors) {
      const queries = this.queryGenerator.generateQueries(vendor);
      const monitorIds: string[] = [];

      for (const qs of queries) {
        this.log.debug(
          "[portfolio] Creating %s monitor for %s",
          qs.risk_dimension,
          vendor.vendor_name,
        );

        const monitor = await this.monitorClient.createMonitor({
          query: qs.query,
          cadence: qs.cadence,
          webhook: this.webhook,
          metadata: {
            vendor_name: vendor.vendor_name,
            vendor_domain: vendor.vendor_domain,
            monitor_category: qs.monitor_category,
            risk_dimension: qs.risk_dimension,
          },
          output_schema: MONITOR_OUTPUT_SCHEMA,
        });

        monitorIds.push(monitor.monitor_id);
      }

      result.set(vendor.vendor_domain, monitorIds);
    }

    return result;
  }

  // ── Remove monitors ────────────────────────────────────────────────────

  async removeMonitors(monitorIds: string[]): Promise<void> {
    for (const id of monitorIds) {
      this.log.debug("[portfolio] Deleting monitor %s", id);
      await this.monitorClient.deleteMonitor(id);
    }
  }

  // ── Apply a full reconciliation ────────────────────────────────────────

  async applyReconciliation(
    reconcileResult: ReconcileResult,
  ): Promise<{ created: Map<string, string[]>; deleted: string[] }> {
    const vendorsToCreate = reconcileResult.to_create.map((e) => e.vendor);
    const created = await this.deployMonitors(vendorsToCreate);

    const idsToDelete = reconcileResult.to_delete.flatMap((e) => e.monitor_ids);
    await this.removeMonitors(idsToDelete);

    return { created, deleted: idsToDelete };
  }
}
