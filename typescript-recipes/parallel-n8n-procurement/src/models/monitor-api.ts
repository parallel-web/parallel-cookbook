import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────────────────

export const MonitorStatusSchema = z.enum(["active", "canceled"]);

export const MonitorCadenceSchema = z.enum(["daily", "weekly"]);

export const MonitorEventTypeSchema = z.enum(["event", "error", "completion"]);

// ── Monitor Webhook ────────────────────────────────────────────────────────

export const MonitorWebhookSchema = z.object({
  url: z.string().url(),
  event_types: z.array(z.string()).default(["monitor.event.detected"]),
});

// ── Monitor Metadata (PRD per-vendor portfolio) ────────────────────────────

export const MonitorMetadataSchema = z
  .object({
    vendor_name: z.string(),
    vendor_domain: z.string(),
    monitor_category: z.string(),
    risk_dimension: z.string(),
  })
  .catchall(z.unknown());

// ── Monitor Output Schema (PRD Section 5.3 flat schema) ───────────────────

export const MonitorOutputSchemaDefinition = z.object({
  event_summary: z.string(),
  severity: z.string(),
  adverse: z.boolean(),
  event_type: z.string(),
});

// ── Monitor ────────────────────────────────────────────────────────────────

export const MonitorSchema = z
  .object({
    monitor_id: z.string(),
    query: z.string(),
    status: MonitorStatusSchema,
    cadence: z.string(),
    metadata: z.record(z.unknown()).optional(),
    webhook: z
      .union([z.string(), MonitorWebhookSchema])
      .optional()
      .nullable(),
    output_schema: z.record(z.unknown()).optional(),
    created_at: z.string().optional(),
    last_run_at: z.string().optional().nullable(),
  })
  .passthrough();

// ── Monitor List Response ──────────────────────────────────────────────────

export const MonitorListResponseSchema = z
  .object({
    monitors: z.array(MonitorSchema),
    total_count: z.number().optional(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  })
  .passthrough();

// ── Monitor Event ──────────────────────────────────────────────────────────

export const MonitorEventSchema = z
  .object({
    type: MonitorEventTypeSchema,
    event_id: z.string().optional(),
    event_group_id: z.string().optional(),
    monitor_id: z.string().optional(),
    event_date: z.string().optional(),
    output: z.union([z.string(), z.record(z.unknown())]).optional(),
    source_urls: z.array(z.string()).optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

// ── Event Group Details ────────────────────────────────────────────────────

export const EventGroupDetailsSchema = z
  .object({
    event_group_id: z.string(),
    monitor_id: z.string(),
    events: z.array(MonitorEventSchema),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

// ── Monitor Webhook Payload (inbound from Parallel) ───────────────────────

export const MonitorWebhookPayloadSchema = z
  .object({
    type: z.string(),
    data: z.object({
      monitor_id: z.string(),
      event: z
        .object({
          event_group_id: z.string(),
        })
        .passthrough(),
      metadata: z.record(z.unknown()).optional(),
    }),
  })
  .passthrough();

// ── Derived TypeScript Types ───────────────────────────────────────────────

export type MonitorStatus = z.infer<typeof MonitorStatusSchema>;
export type MonitorCadence = z.infer<typeof MonitorCadenceSchema>;
export type MonitorEventType = z.infer<typeof MonitorEventTypeSchema>;
export type MonitorWebhook = z.infer<typeof MonitorWebhookSchema>;
export type MonitorMetadata = z.infer<typeof MonitorMetadataSchema>;
export type MonitorOutputSchemaType = z.infer<typeof MonitorOutputSchemaDefinition>;
export type Monitor = z.infer<typeof MonitorSchema>;
export type MonitorListResponse = z.infer<typeof MonitorListResponseSchema>;
export type MonitorEvent = z.infer<typeof MonitorEventSchema>;
export type EventGroupDetails = z.infer<typeof EventGroupDetailsSchema>;
export type MonitorWebhookPayload = z.infer<typeof MonitorWebhookPayloadSchema>;

// ── Request Types ──────────────────────────────────────────────────────────

export interface MonitorCreateInput {
  query: string;
  cadence: MonitorCadence;
  webhook?: MonitorWebhook;
  metadata?: MonitorMetadata;
  output_schema?: Record<string, unknown>;
}

export interface MonitorUpdateInput {
  cadence?: MonitorCadence;
  webhook?: MonitorWebhook;
  metadata?: Record<string, unknown>;
}
