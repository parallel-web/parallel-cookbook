import axios from "axios";
import { writeFile } from "node:fs/promises";
import { VendorSchema, type Vendor } from "../models/vendor.js";
import type { VendorDiff, DiffResult } from "../models/vendor-diff.js";
import type { MonitorPortfolioManager } from "./monitor-portfolio-manager.js";
import { parseCSV } from "../utils/csv-parser.js";

// ── Options ────────────────────────────────────────────────────────────────

export interface VendorIngestionServiceOptions {
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Service ────────────────────────────────────────────────────────────────

export class VendorIngestionService {
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  constructor(options?: VendorIngestionServiceOptions) {
    this.log = options?.logger ?? console;
  }

  // ── Ingestion ──────────────────────────────────────────────────────────

  async ingestFromGoogleSheets(
    sheetId: string,
    range: string,
    apiKey?: string,
  ): Promise<Vendor[]> {
    this.log.debug("[ingestion] Reading Google Sheet %s range %s", sheetId, range);

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
    const params: Record<string, string> = {};
    if (apiKey) params.key = apiKey;

    const response = await axios.get(url, { params });
    const rows: string[][] = response.data.values ?? [];

    if (rows.length <= 1) return []; // header only or empty

    return this.parseRows(rows.slice(1));
  }

  async ingestFromCSV(csvContent: string): Promise<Vendor[]> {
    this.log.debug("[ingestion] Parsing CSV content");

    const rows = parseCSV(csvContent);
    if (rows.length <= 1) return []; // header only or empty

    return this.parseRows(rows.slice(1));
  }

  // ── Deduplication ──────────────────────────────────────────────────────

  deduplicateVendors(vendors: Vendor[]): Vendor[] {
    const byDomain = new Map<string, Vendor>();
    for (const v of vendors) {
      byDomain.set(v.vendor_domain, v);
    }
    return [...byDomain.values()];
  }

  // ── Diff Engine ────────────────────────────────────────────────────────

  computeDiff(incoming: Vendor[], previous: Vendor[]): VendorDiff {
    const incomingMap = new Map(incoming.map((v) => [v.vendor_domain, v]));
    const previousMap = new Map(previous.map((v) => [v.vendor_domain, v]));

    const added: Vendor[] = [];
    const modified: VendorDiff["modified"] = [];
    const unchanged: Vendor[] = [];

    for (const [domain, vendor] of incomingMap) {
      const prev = previousMap.get(domain);
      if (!prev) {
        added.push(vendor);
      } else {
        const changes: string[] = [];
        if (vendor.monitoring_priority !== prev.monitoring_priority) {
          changes.push("monitoring_priority");
        }
        if (vendor.vendor_category !== prev.vendor_category) {
          changes.push("vendor_category");
        }
        if (vendor.risk_tier_override !== prev.risk_tier_override) {
          changes.push("risk_tier_override");
        }
        if (vendor.active !== prev.active) {
          changes.push("active");
        }

        if (changes.length > 0) {
          modified.push({ vendor, previous: prev, changes });
        } else {
          unchanged.push(vendor);
        }
      }
    }

    const removed: Vendor[] = [];
    for (const [domain, vendor] of previousMap) {
      if (!incomingMap.has(domain)) {
        removed.push(vendor);
      }
    }

    return { added, removed, unchanged, modified };
  }

  // ── Apply Diff ─────────────────────────────────────────────────────────

  async applyDiff(
    diff: VendorDiff,
    portfolioManager: MonitorPortfolioManager,
  ): Promise<DiffResult> {
    const monitorsCreated = new Map<string, string[]>();
    const monitorsDeleted: string[] = [];
    const monitorsAdjusted: string[] = [];
    const errors: Array<{ vendor_domain: string; error: string }> = [];

    // Deploy monitors for added vendors
    if (diff.added.length > 0) {
      try {
        const created = await portfolioManager.deployMonitors(diff.added);
        for (const [domain, ids] of created) {
          monitorsCreated.set(domain, ids);
        }
      } catch (err) {
        for (const v of diff.added) {
          errors.push({
            vendor_domain: v.vendor_domain,
            error: `Failed to deploy monitors: ${(err as Error).message}`,
          });
        }
      }
    }

    // Remove monitors for removed vendors
    for (const vendor of diff.removed) {
      if (vendor.monitor_ids && vendor.monitor_ids.length > 0) {
        try {
          await portfolioManager.removeMonitors(vendor.monitor_ids);
          monitorsDeleted.push(...vendor.monitor_ids);
        } catch (err) {
          errors.push({
            vendor_domain: vendor.vendor_domain,
            error: `Failed to remove monitors: ${(err as Error).message}`,
          });
        }
      }
    }

    // Handle modified vendors (priority changes need monitor adjustment)
    for (const mod of diff.modified) {
      if (mod.changes.includes("monitoring_priority")) {
        try {
          // Remove old monitors
          if (mod.previous.monitor_ids && mod.previous.monitor_ids.length > 0) {
            await portfolioManager.removeMonitors(mod.previous.monitor_ids);
            monitorsDeleted.push(...mod.previous.monitor_ids);
          }
          // Deploy new monitors with updated priority
          const created = await portfolioManager.deployMonitors([mod.vendor]);
          for (const [domain, ids] of created) {
            monitorsCreated.set(domain, ids);
          }
          monitorsAdjusted.push(mod.vendor.vendor_domain);
        } catch (err) {
          errors.push({
            vendor_domain: mod.vendor.vendor_domain,
            error: `Failed to adjust monitors: ${(err as Error).message}`,
          });
        }
      }
    }

    return {
      monitors_created: monitorsCreated,
      monitors_deleted: monitorsDeleted,
      monitors_adjusted: monitorsAdjusted,
      errors,
    };
  }

  // ── Registry Persistence ───────────────────────────────────────────────

  async updateRegistry(
    vendors: Vendor[],
    monitorMapping: Map<string, string[]>,
    outputPath?: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    const updated = vendors.map((v) => ({
      ...v,
      monitor_ids: monitorMapping.get(v.vendor_domain) ?? v.monitor_ids ?? [],
      last_synced_at: now,
    }));

    const registry = {
      vendors: updated,
      last_sync_timestamp: now,
      total_count: updated.length,
    };

    const path = outputPath ?? "vendor-registry.json";
    await writeFile(path, JSON.stringify(registry, null, 2));

    this.log.debug(
      "[ingestion] Registry updated: %d vendors written to %s",
      updated.length,
      path,
    );
  }

  // ── Private: Row Parsing ───────────────────────────────────────────────

  private parseRows(rows: string[][]): Vendor[] {
    const vendors: Vendor[] = [];

    for (const row of rows) {
      if (row.length < 3) continue; // Need at least name, domain, category

      try {
        const vendor = VendorSchema.parse(this.rowToObject(row));
        vendors.push(vendor);
      } catch (err) {
        this.log.warn(
          "[ingestion] Skipping invalid row: %s — %s",
          row[0] ?? "unknown",
          (err as Error).message,
        );
      }
    }

    return vendors;
  }

  private rowToObject(row: string[]): Record<string, unknown> {
    const [
      vendor_name = "",
      vendor_domain = "",
      vendor_category = "",
      risk_tier_override = "",
      active = "",
      monitoring_priority = "",
    ] = row;

    // Normalize domain
    let domain = vendor_domain.trim();
    if (domain && !domain.startsWith("http://") && !domain.startsWith("https://")) {
      domain = `https://${domain}`;
    }

    return {
      vendor_name: vendor_name.trim(),
      vendor_domain: domain,
      vendor_category: vendor_category.trim().toLowerCase(),
      risk_tier_override: risk_tier_override.trim() || undefined,
      active: this.parseBoolean(active.trim()),
      monitoring_priority: monitoring_priority.trim().toLowerCase() || "medium",
    };
  }

  private parseBoolean(value: string): boolean {
    if (!value) return true; // default active
    const lower = value.toLowerCase();
    return lower !== "false" && lower !== "0" && lower !== "no";
  }
}
