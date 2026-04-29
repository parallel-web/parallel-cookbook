import axios from "axios";
import type { Monitor, MonitorCadence } from "../models/monitor-api.js";
import type { Vendor } from "../models/vendor.js";
import type {
  CleanupResult,
  RecreationResult,
  HealthCheckReport,
} from "../models/health-check.js";
import type { ParallelMonitorClient } from "./parallel-monitor-client.js";

// ── Options ────────────────────────────────────────────────────────────────

export interface MonitorHealthCheckerOptions {
  monitorClient: ParallelMonitorClient;
  webhookUrl?: string;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Health Checker ─────────────────────────────────────────────────────────

export class MonitorHealthChecker {
  private readonly monitorClient: ParallelMonitorClient;
  private readonly webhookUrl?: string;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  constructor(options: MonitorHealthCheckerOptions) {
    this.monitorClient = options.monitorClient;
    this.webhookUrl = options.webhookUrl;
    this.log = options.logger ?? console;
  }

  // ── Top-Level Health Check ─────────────────────────────────────────────

  async runHealthCheck(vendors: Vendor[]): Promise<HealthCheckReport> {
    this.log.debug("[health] Starting monitor fleet health check");

    const listResponse = await this.monitorClient.listMonitors();
    const allMonitors = listResponse.monitors;

    const orphans = this.detectOrphanedMonitors(allMonitors, vendors);
    const failed = this.detectFailedMonitors(allMonitors);

    const cleanupResult = await this.cleanupOrphans(orphans);
    const recreationResult = await this.recreateFailedMonitors(failed, vendors);

    const webhookHealthy = this.webhookUrl
      ? await this.selfPingWebhook(this.webhookUrl)
      : true;

    return this.compileReport(
      allMonitors,
      orphans,
      failed,
      cleanupResult,
      recreationResult,
      webhookHealthy,
    );
  }

  // ── Detection ──────────────────────────────────────────────────────────

  detectOrphanedMonitors(
    activeMonitors: Monitor[],
    registeredVendors: Vendor[],
  ): Monitor[] {
    const activeDomains = new Set(
      registeredVendors.filter((v) => v.active).map((v) => v.vendor_domain),
    );

    return activeMonitors.filter((m) => {
      const vendorDomain = m.metadata?.vendor_domain as string | undefined;
      if (!vendorDomain) return true; // no metadata = orphan
      return !activeDomains.has(vendorDomain);
    });
  }

  detectFailedMonitors(activeMonitors: Monitor[]): Monitor[] {
    return activeMonitors.filter((m) => m.status !== "active");
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  async cleanupOrphans(orphans: Monitor[]): Promise<CleanupResult> {
    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const monitor of orphans) {
      try {
        await this.monitorClient.deleteMonitor(monitor.monitor_id);
        deleted++;
        this.log.debug("[health] Deleted orphan monitor %s", monitor.monitor_id);
      } catch (err) {
        failed++;
        errors.push(`Failed to delete ${monitor.monitor_id}: ${(err as Error).message}`);
      }
    }

    return { deleted, failed, errors };
  }

  async recreateFailedMonitors(
    failed: Monitor[],
    vendors: Vendor[],
  ): Promise<RecreationResult> {
    const vendorByDomain = new Map(vendors.map((v) => [v.vendor_domain, v]));
    let recreated = 0;
    let failCount = 0;
    const newMonitorIds: string[] = [];
    const errors: string[] = [];

    for (const monitor of failed) {
      const vendorDomain = monitor.metadata?.vendor_domain as string | undefined;
      if (!vendorDomain || !vendorByDomain.has(vendorDomain)) {
        this.log.warn(
          "[health] Cannot recreate monitor %s — vendor not found",
          monitor.monitor_id,
        );
        failCount++;
        errors.push(`Vendor not found for monitor ${monitor.monitor_id}`);
        continue;
      }

      try {
        await this.monitorClient.deleteMonitor(monitor.monitor_id);

        const newMonitor = await this.monitorClient.createMonitor({
          query: monitor.query,
          cadence: (monitor.cadence as MonitorCadence) ?? "daily",
          metadata: monitor.metadata as {
            vendor_name: string;
            vendor_domain: string;
            monitor_category: string;
            risk_dimension: string;
          },
          output_schema: monitor.output_schema,
        });

        newMonitorIds.push(newMonitor.monitor_id);
        recreated++;
        this.log.debug(
          "[health] Recreated monitor %s → %s",
          monitor.monitor_id,
          newMonitor.monitor_id,
        );
      } catch (err) {
        failCount++;
        errors.push(`Failed to recreate ${monitor.monitor_id}: ${(err as Error).message}`);
      }
    }

    return { recreated, failed: failCount, new_monitor_ids: newMonitorIds, errors };
  }

  // ── Webhook Self-Ping ──────────────────────────────────────────────────

  async selfPingWebhook(webhookUrl: string): Promise<boolean> {
    try {
      const response = await axios.get(webhookUrl, { timeout: 10_000 });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  // ── Report Compilation ─────────────────────────────────────────────────

  compileReport(
    allMonitors: Monitor[],
    orphans: Monitor[],
    failed: Monitor[],
    cleanupResult: CleanupResult,
    recreationResult: RecreationResult,
    webhookHealthy: boolean,
  ): HealthCheckReport {
    const activeCount = allMonitors.filter((m) => m.status === "active").length
      - orphans.filter((m) => m.status === "active").length;

    return {
      timestamp: new Date().toISOString(),
      total_monitors: allMonitors.length,
      active_count: activeCount,
      failed_count: failed.length,
      orphan_count: orphans.length,
      orphans_deleted: cleanupResult.deleted,
      monitors_recreated: recreationResult.recreated,
      webhook_healthy: webhookHealthy,
      errors: [...cleanupResult.errors, ...recreationResult.errors],
    };
  }
}
