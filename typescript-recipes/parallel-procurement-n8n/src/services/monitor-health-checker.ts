import type {
  Monitor,
  MonitorEventStreamSettings,
  MonitorProcessor,
} from "../models/monitor-api.js";
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
  /**
   * If true, fire a `monitor.trigger` against each freshly-recreated
   * monitor so it runs immediately instead of waiting for the next cron.
   * Defaults to true.
   */
  triggerRecreated?: boolean;
  /**
   * Optional resolver for the webhook URL used by recreated monitors. The
   * dashboard's webhook URL embeds a token derived from
   * PARALLEL_WEBHOOK_SECRET; if that secret rotates, the original
   * `monitor.webhook` value carried on the cancelled monitor is stale.
   * Pass a resolver here (e.g. `() => monitorWebhookUrl()`) so each new
   * monitor picks up the fresh URL on recreation (finding 8).
   */
  webhookUrlForRecreated?: () => Promise<string>;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Health Checker ─────────────────────────────────────────────────────────

export class MonitorHealthChecker {
  private readonly monitorClient: ParallelMonitorClient;
  private readonly webhookUrl?: string;
  private readonly triggerRecreated: boolean;
  private readonly webhookUrlForRecreated?: () => Promise<string>;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  constructor(options: MonitorHealthCheckerOptions) {
    this.monitorClient = options.monitorClient;
    this.webhookUrl = options.webhookUrl;
    this.triggerRecreated = options.triggerRecreated ?? true;
    this.webhookUrlForRecreated = options.webhookUrlForRecreated;
    this.log = options.logger ?? console;
  }

  // ── Top-Level Health Check ─────────────────────────────────────────────

  async runHealthCheck(vendors: Vendor[]): Promise<HealthCheckReport> {
    this.log.debug("[health] Starting monitor fleet health check");

    // Pull every monitor (active + cancelled) so we can audit the fleet.
    // The SDK paginates automatically via listAllMonitors().
    const allMonitors = await this.monitorClient.listAllMonitors({
      status: ["active", "cancelled"],
      type: ["event_stream"],
    });

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
      const vendorDomain = m.metadata?.vendor_domain;
      if (!vendorDomain) return true;
      return !activeDomains.has(vendorDomain);
    });
  }

  detectFailedMonitors(activeMonitors: Monitor[]): Monitor[] {
    // V1 status enum uses double-l "cancelled". Treat anything that isn't
    // still active as "failed" so the fleet stays self-healed.
    return activeMonitors.filter((m) => m.status !== "active");
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  async cleanupOrphans(orphans: Monitor[]): Promise<CleanupResult> {
    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const monitor of orphans) {
      // Skip monitors that are already cancelled — cancellation is a
      // no-op per the V1 docs but we save a round trip.
      if (monitor.status === "cancelled") continue;

      try {
        await this.monitorClient.cancelMonitor(monitor.monitor_id);
        deleted++;
        this.log.debug("[health] Cancelled orphan monitor %s", monitor.monitor_id);
      } catch (err) {
        failed++;
        errors.push(`Failed to cancel ${monitor.monitor_id}: ${(err as Error).message}`);
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
      // Skip cancelled monitors whose vendor is also gone — already
      // covered by cleanupOrphans.
      const vendorDomain = monitor.metadata?.vendor_domain;
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
        // V1: cancellation is irreversible, so we cancel the dead monitor
        // and immediately stand up a fresh one with the same settings.
        if (monitor.status === "active") {
          await this.monitorClient.cancelMonitor(monitor.monitor_id);
        }

        // Snapshot monitors are tracked separately and shouldn't appear
        // here, but guard the cast anyway.
        if (monitor.type !== "event_stream") {
          this.log.warn(
            "[health] Skipping non-event_stream monitor %s",
            monitor.monitor_id,
          );
          continue;
        }

        const settings = monitor.settings as MonitorEventStreamSettings;
        const processor: MonitorProcessor = monitor.processor ?? "lite";

        // Prefer a freshly-computed webhook URL when a resolver is
        // provided so that token rotations (PARALLEL_WEBHOOK_SECRET) are
        // picked up automatically. Without the resolver we fall back to
        // the URL stored on the cancelled monitor, which may be stale.
        let webhook = monitor.webhook ?? undefined;
        if (this.webhookUrlForRecreated) {
          try {
            const fresh = await this.webhookUrlForRecreated();
            const eventTypes = monitor.webhook?.event_types ?? [
              "monitor.event.detected",
            ];
            webhook = { url: fresh, event_types: eventTypes };
          } catch (err) {
            this.log.warn(
              "[health] webhookUrlForRecreated resolver failed; falling back to stored URL: %s",
              (err as Error).message,
            );
          }
        }

        const newMonitor = await this.monitorClient.createMonitor({
          type: "event_stream",
          frequency: monitor.frequency,
          processor,
          settings: {
            query: settings.query,
            output_schema: settings.output_schema ?? undefined,
            include_backfill: settings.include_backfill ?? false,
            advanced_settings: settings.advanced_settings ?? { location: "us" },
          },
          ...(webhook ? { webhook } : {}),
          ...(monitor.metadata
            ? { metadata: monitor.metadata as Record<string, string> }
            : {}),
        });

        newMonitorIds.push(newMonitor.monitor_id);
        recreated++;
        this.log.debug(
          "[health] Recreated monitor %s -> %s",
          monitor.monitor_id,
          newMonitor.monitor_id,
        );

        // Kick the new monitor immediately so the dashboard sees a fresh
        // signal instead of waiting up to `frequency` for the first run.
        if (this.triggerRecreated) {
          try {
            await this.monitorClient.triggerMonitor(newMonitor.monitor_id);
          } catch (triggerErr) {
            this.log.warn(
              "[health] Triggered-run for %s failed: %s",
              newMonitor.monitor_id,
              (triggerErr as Error).message,
            );
          }
        }
      } catch (err) {
        failCount++;
        errors.push(`Failed to recreate ${monitor.monitor_id}: ${(err as Error).message}`);
      }
    }

    return { recreated, failed: failCount, new_monitor_ids: newMonitorIds, errors };
  }

  // ── Webhook Self-Ping ──────────────────────────────────────────────────

  // Both the dashboard's /api/webhooks/parallel-monitor and the n8n
  // monitor-event webhook only accept POST. A bare GET against them
  // returned 405, which used to make the checker mark the fleet
  // "webhook_healthy: false" even though the endpoint was fine (finding 7).
  //
  // We now try a HEAD first (cheap, most stacks answer with 200/204/405
  // routing intact) and fall back to a POST with `{ ping: true }` so a
  // handler that wants to short-circuit can do so by checking the body.
  // Anything but a 5xx or a network error means the endpoint is reachable;
  // 401/403/404/405 all indicate "the routing layer can see us".
  async selfPingWebhook(webhookUrl: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      let response = await fetch(webhookUrl, {
        method: "HEAD",
        signal: controller.signal,
      });
      // Some hosts treat HEAD as method-not-allowed but still accept POST.
      if (response.status === 405 || response.status === 501) {
        response = await fetch(webhookUrl, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ping: true }),
        });
      }
      // Reachable means the routing layer answered. 5xx or network error
      // are the only "unreachable" cases we care about.
      return response.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
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
    const activeCount =
      allMonitors.filter((m) => m.status === "active").length -
      orphans.filter((m) => m.status === "active").length;

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
