import type { MonitorWebhookPayload, EventGroupDetails } from "../models/monitor-api.js";
import type { MonitorEventOutput, RiskAssessment } from "../models/risk-assessment.js";
import type {
  EnrichedEvent,
  EventHandlerResult,
  MonitorRegistryContext,
} from "../models/monitor-events.js";
import type { ParallelMonitorClient } from "./parallel-monitor-client.js";
import type { RiskScorer } from "./risk-scorer.js";
import type { SlackFormatter } from "./slack-formatter.js";
import type { SlackDeliveryService } from "./slack-delivery.js";
import type { AuditLogger } from "./audit-logger.js";
import type { EventDedupCache } from "./event-dedup-cache.js";
import type { RiskTier } from "../models/vendor.js";

// ── Options ────────────────────────────────────────────────────────────────

export interface MonitorEventHandlerOptions {
  monitorClient: ParallelMonitorClient;
  riskScorer: RiskScorer;
  formatter: SlackFormatter;
  deliveryService: SlackDeliveryService;
  auditLogger: AuditLogger;
  dedupCache: EventDedupCache;
  monitorRegistry: (monitorId: string) => MonitorRegistryContext | undefined;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Handler ────────────────────────────────────────────────────────────────

export class MonitorEventHandler {
  private readonly monitorClient: ParallelMonitorClient;
  private readonly riskScorer: RiskScorer;
  private readonly formatter: SlackFormatter;
  private readonly deliveryService: SlackDeliveryService;
  private readonly auditLogger: AuditLogger;
  private readonly dedupCache: EventDedupCache;
  private readonly monitorRegistry: (monitorId: string) => MonitorRegistryContext | undefined;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  constructor(options: MonitorEventHandlerOptions) {
    this.monitorClient = options.monitorClient;
    this.riskScorer = options.riskScorer;
    this.formatter = options.formatter;
    this.deliveryService = options.deliveryService;
    this.auditLogger = options.auditLogger;
    this.dedupCache = options.dedupCache;
    this.monitorRegistry = options.monitorRegistry;
    this.log = options.logger ?? console;
  }

  // ── Main Entry Point ───────────────────────────────────────────────────

  async handleWebhookEvent(
    payload: MonitorWebhookPayload,
  ): Promise<EventHandlerResult> {
    const monitorId = payload.data.monitor_id;
    const eventGroupId = payload.data.event.event_group_id;

    this.log.debug(
      "[event-handler] Received webhook for monitor %s, event group %s",
      monitorId,
      eventGroupId,
    );

    // Look up vendor context
    const context = this.monitorRegistry(monitorId);
    if (!context) {
      this.log.warn("[event-handler] Unknown monitor_id: %s", monitorId);
      return {
        processed: false,
        duplicate: false,
        event_group_id: eventGroupId,
        error: `Unknown monitor: ${monitorId}`,
      };
    }

    // Fetch full event details
    const eventDetails = await this.monitorClient.getEventGroupDetails(
      monitorId,
      eventGroupId,
    );

    // Enrich
    const enriched = this.enrichEvent(monitorId, eventDetails, context);

    // Dedup check
    if (this.isDuplicate(enriched)) {
      this.log.debug(
        "[event-handler] Duplicate event for %s, skipping",
        context.vendor_name,
      );
      return {
        processed: false,
        duplicate: true,
        vendor_domain: context.vendor_domain,
        event_group_id: eventGroupId,
      };
    }

    // Score
    const eventOutput: MonitorEventOutput = {
      event_summary: enriched.event_summary,
      severity: enriched.severity,
      adverse: enriched.adverse,
      event_type: enriched.event_type,
    };

    const assessment = this.riskScorer.scoreMonitorEvent(eventOutput, {
      vendor_name: context.vendor_name,
      vendor_domain: context.vendor_domain,
      monitoring_priority: context.monitoring_priority,
    });

    // Format + deliver
    const vendor = {
      vendor_name: context.vendor_name,
      vendor_domain: context.vendor_domain,
      vendor_category: "other" as const,
      monitoring_priority: context.monitoring_priority as "high" | "medium" | "low",
      active: true,
    };

    const message = this.formatter.formatMonitorAlert(assessment, vendor, eventOutput);
    await this.deliveryService.sendAlert(message);

    // Record
    await this.recordEvent(enriched, assessment);

    return {
      processed: true,
      duplicate: false,
      assessment,
      vendor_domain: context.vendor_domain,
      event_group_id: eventGroupId,
    };
  }

  // ── Enrich ─────────────────────────────────────────────────────────────

  enrichEvent(
    monitorId: string,
    eventData: EventGroupDetails,
    context?: MonitorRegistryContext,
  ): EnrichedEvent {
    const ctx = context ?? this.monitorRegistry(monitorId);
    if (!ctx) {
      throw new Error(`No registry context for monitor ${monitorId}`);
    }

    // Find first "event" type entry (skip "completion" and "error")
    const eventEntry = eventData.events.find((e) => e.type === "event");

    // Parse output
    let eventSummary = "";
    let severity: RiskTier = "LOW";
    let adverse = false;
    let eventType = ctx.risk_dimension;

    if (eventEntry?.output) {
      const output =
        typeof eventEntry.output === "string"
          ? eventEntry.output
          : eventEntry.output;

      if (typeof output === "object" && output !== null) {
        const o = output as Record<string, unknown>;
        eventSummary = String(o.event_summary ?? "");
        severity = (String(o.severity ?? "LOW").toUpperCase() as RiskTier);
        adverse = Boolean(o.adverse);
        eventType = String(o.event_type ?? ctx.risk_dimension);
      } else {
        eventSummary = String(output);
      }
    }

    return {
      event_id: eventEntry?.event_id,
      event_group_id: eventData.event_group_id,
      monitor_id: eventData.monitor_id,
      event_date: eventEntry?.event_date,
      source_urls: eventEntry?.source_urls,
      vendor_name: ctx.vendor_name,
      vendor_domain: ctx.vendor_domain,
      risk_dimension: ctx.risk_dimension,
      monitoring_priority: ctx.monitoring_priority,
      monitor_category: ctx.monitor_category,
      event_summary: eventSummary,
      severity,
      adverse,
      event_type: eventType,
    };
  }

  // ── Dedup ──────────────────────────────────────────────────────────────

  isDuplicate(event: EnrichedEvent): boolean {
    const key = this.dedupCache.generateKey(event);
    return this.dedupCache.has(key);
  }

  // ── Record ─────────────────────────────────────────────────────────────

  async recordEvent(
    event: EnrichedEvent,
    assessment: RiskAssessment,
  ): Promise<void> {
    const key = this.dedupCache.generateKey(event);
    this.dedupCache.add(key);

    await this.auditLogger.logAssessment({
      timestamp: new Date().toISOString(),
      vendor_name: event.vendor_name,
      risk_level: assessment.risk_level,
      adverse_flag: assessment.adverse_flag,
      categories: assessment.risk_categories.join(", "),
      summary: assessment.summary,
      run_id: event.event_group_id,
      source: "monitor_event",
    });
  }
}
