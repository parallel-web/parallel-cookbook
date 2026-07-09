import type {
  MonitorWebhookPayload,
  MonitorEvent,
  MonitorEventStreamEvent,
} from "../models/monitor-api.js";
import type {
  BasisEntry,
  MonitorEventOutput,
  RiskAssessment,
} from "../models/risk-assessment.js";
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

    // V1: resolve full event details via the unified /events endpoint
    // filtered by `event_group_id`. Returns at most a handful of events
    // (one execution = one event_stream event + zero or one completion).
    const page = await this.monitorClient.listEvents(monitorId, {
      event_group_id: eventGroupId,
      include_completions: false,
    });

    const enriched = this.enrichEvent(monitorId, page.events, context);
    if (!enriched) {
      this.log.warn(
        "[event-handler] No event_stream event found in group %s",
        eventGroupId,
      );
      return {
        processed: false,
        duplicate: false,
        vendor_domain: context.vendor_domain,
        event_group_id: eventGroupId,
        error: "No event_stream event in group",
      };
    }

    // Dedup is keyed on (vendor_domain, event_type, severity) with a 24h
    // window. Industry-wide stories that fire multiple monitors collapse
    // to a single Slack alert.
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

    // Score using the same engine that scores deep research, with `basis`
    // forwarded so the assessment can carry citations.
    const eventOutput: MonitorEventOutput = {
      event_summary: enriched.event_summary,
      severity: enriched.severity,
      adverse: enriched.adverse,
      event_type: enriched.event_type,
    };

    const assessment = this.riskScorer.scoreMonitorEvent(
      eventOutput,
      {
        vendor_name: context.vendor_name,
        vendor_domain: context.vendor_domain,
        monitoring_priority: context.monitoring_priority,
      },
      enriched.basis,
    );

    const vendor = {
      vendor_name: context.vendor_name,
      vendor_domain: context.vendor_domain,
      vendor_category: "other" as const,
      monitoring_priority: context.monitoring_priority as "high" | "medium" | "low",
      active: true,
    };

    const message = this.formatter.formatMonitorAlert(assessment, vendor, eventOutput);
    await this.deliveryService.sendAlert(message);

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

  // Pull the first event_stream event out of the page and normalize its
  // structured `output` into the procurement-flat shape the scorer
  // expects. V1 events always carry `output: { type, content, basis }` —
  // no more "string fallback" branch.
  enrichEvent(
    monitorId: string,
    events: MonitorEvent[],
    context?: MonitorRegistryContext,
  ): EnrichedEvent | undefined {
    const ctx = context ?? this.monitorRegistry(monitorId);
    if (!ctx) {
      throw new Error(`No registry context for monitor ${monitorId}`);
    }

    const eventEntry = events.find(
      (e): e is MonitorEventStreamEvent =>
        (e as { event_type?: string }).event_type === "event_stream" ||
        // V1 makes `event_type` optional with default "event_stream";
        // treat any event carrying an `output` as the canonical entry.
        ((e as { output?: unknown }).output !== undefined &&
          (e as { event_type?: string }).event_type !== "snapshot"),
    );

    if (!eventEntry) return undefined;

    const content = eventEntry.output.content;
    const basis: BasisEntry[] = Array.isArray(eventEntry.output.basis)
      ? eventEntry.output.basis
      : [];

    let eventSummary = "";
    let severity: RiskTier = "LOW";
    let adverse = false;
    let eventType = ctx.risk_dimension;

    if (eventEntry.output.type === "json" && typeof content === "object" && content !== null) {
      const o = content as Record<string, unknown>;
      eventSummary = String(o.event_summary ?? "");
      severity = String(o.severity ?? "LOW").toUpperCase() as RiskTier;
      adverse = Boolean(o.adverse);
      eventType = String(o.event_type ?? ctx.risk_dimension);
    } else if (eventEntry.output.type === "text" && typeof content === "string") {
      // Text-output fallback for monitors created without an output_schema.
      eventSummary = content;
    }

    return {
      event_id: eventEntry.event_id,
      event_group_id: eventEntry.event_group_id,
      monitor_id: monitorId,
      event_date: eventEntry.event_date,
      vendor_name: ctx.vendor_name,
      vendor_domain: ctx.vendor_domain,
      risk_dimension: ctx.risk_dimension,
      monitoring_priority: ctx.monitoring_priority,
      monitor_category: ctx.monitor_category,
      event_summary: eventSummary,
      severity,
      adverse,
      event_type: eventType,
      basis,
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

    // Pull the highest-confidence citation from the basis (already lifted
    // into `assessment.top_citations` by the scorer) for the audit row.
    const top = assessment.top_citations?.[0];

    await this.auditLogger.logAssessment({
      timestamp: new Date().toISOString(),
      vendor_name: event.vendor_name,
      risk_level: assessment.risk_level,
      adverse_flag: assessment.adverse_flag,
      categories: assessment.risk_categories.join(", "),
      summary: assessment.summary,
      run_id: event.event_group_id,
      source: "monitor_event",
      top_citation_url: top?.url,
      top_citation_title: top?.title ?? undefined,
      confidence: top?.confidence ?? undefined,
    });
  }
}
