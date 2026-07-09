import { z } from "zod";
import { BasisEntrySchema, TaskRunOutputSchema } from "./task-api.js";

// ── Enums ──────────────────────────────────────────────────────────────────

export const MonitorStatusSchema = z.enum(["active", "cancelled"]);

export const MonitorTypeSchema = z.enum(["event_stream", "snapshot"]);

export const MonitorProcessorSchema = z.enum(["lite", "base"]);

export const MonitorEventTypeSchema = z.enum([
  "event_stream",
  "snapshot",
  "completion",
  "error",
]);

// `frequency` is a string like "1h", "1d", "7d", "4w" (between 1h and 30d).
// We keep the strict pattern light to stay forward-compatible.
export const MonitorFrequencySchema = z
  .string()
  .regex(/^\d+[hdw]$/, "frequency must look like 1h, 1d, 7d, 4w");

// ── Webhook ────────────────────────────────────────────────────────────────

export const MonitorWebhookEventTypeSchema = z.enum([
  "monitor.event.detected",
  "monitor.execution.completed",
  "monitor.execution.failed",
]);

export const MonitorWebhookSchema = z.object({
  url: z.string().url(),
  event_types: z
    .array(MonitorWebhookEventTypeSchema)
    .default(["monitor.event.detected"]),
});

// ── Metadata (Parallel V1 caps keys at 16 chars and values at 512) ─────────

// We carry the procurement-specific keys verbatim. All values are strings to
// satisfy the V1 metadata contract (`{ [k: string]: string }`).
export const MonitorMetadataSchema = z
  .object({
    vendor_name: z.string(),
    vendor_domain: z.string(),
    monitor_category: z.string(),
    risk_dimension: z.string(),
  })
  .catchall(z.string());

// ── Source Policy (shared) ─────────────────────────────────────────────────

export const SourcePolicySchema = z.object({
  after_date: z.string().nullish(),
  include_domains: z.array(z.string()).optional(),
  exclude_domains: z.array(z.string()).optional(),
});

export const AdvancedMonitorSettingsSchema = z.object({
  location: z.string().nullish(),
  source_policy: SourcePolicySchema.nullish(),
});

// ── Event-Stream Settings ──────────────────────────────────────────────────

export const MonitorEventStreamSettingsSchema = z.object({
  query: z.string(),
  output_schema: z.record(z.unknown()).nullish(),
  include_backfill: z.boolean().nullish(),
  advanced_settings: AdvancedMonitorSettingsSchema.nullish(),
});

// ── Snapshot Settings (request + response) ─────────────────────────────────

export const MonitorSnapshotSettingsSchema = z.object({
  task_run_id: z.string(),
});

export const MonitorSnapshotResponseSettingsSchema = z.object({
  query: z.string(),
  task_run_id: z.string(),
  output_schema: z.record(z.unknown()).nullish(),
});

// ── Snapshot Output (response only) ────────────────────────────────────────

export const MonitorSnapshotOutputSchema = z.object({
  latest_snapshot: TaskRunOutputSchema.nullish(),
});

// ── Monitor (V1 response) ──────────────────────────────────────────────────

export const MonitorSchema = z
  .object({
    monitor_id: z.string(),
    type: MonitorTypeSchema,
    frequency: z.string(),
    processor: MonitorProcessorSchema,
    status: MonitorStatusSchema,
    settings: z.union([
      MonitorEventStreamSettingsSchema,
      MonitorSnapshotResponseSettingsSchema,
    ]),
    webhook: MonitorWebhookSchema.nullish(),
    metadata: z.record(z.string()).nullish(),
    created_at: z.string(),
    last_run_at: z.string().nullish(),
    output: MonitorSnapshotOutputSchema.nullish(),
  })
  .passthrough();

// ── Paginated Monitor List ────────────────────────────────────────────────

export const PaginatedMonitorResponseSchema = z
  .object({
    monitors: z.array(MonitorSchema),
    next_cursor: z.string().nullish(),
  })
  .passthrough();

// ── Monitor Events (V1) ────────────────────────────────────────────────────

// Event-stream event: stable id, typed output, basis carries citations.
export const MonitorEventStreamEventSchema = z
  .object({
    event_id: z.string(),
    event_group_id: z.string(),
    event_date: z.string().nullable(),
    output: TaskRunOutputSchema,
    event_type: z.literal("event_stream").optional(),
  })
  .passthrough();

export const MonitorSnapshotEventSchema = z
  .object({
    event_id: z.string(),
    event_group_id: z.string(),
    event_date: z.string().nullable(),
    changed_output: TaskRunOutputSchema,
    previous_output: TaskRunOutputSchema,
    event_type: z.literal("snapshot").optional(),
  })
  .passthrough();

export const MonitorCompletionEventSchema = z
  .object({
    timestamp: z.string(),
    event_type: z.literal("completion").optional(),
  })
  .passthrough();

export const MonitorErrorEventSchema = z
  .object({
    error_message: z.string(),
    timestamp: z.string(),
    event_type: z.literal("error").optional(),
  })
  .passthrough();

export const MonitorEventSchema = z.union([
  MonitorEventStreamEventSchema,
  MonitorSnapshotEventSchema,
  MonitorCompletionEventSchema,
  MonitorErrorEventSchema,
]);

export const PaginatedMonitorEventsSchema = z
  .object({
    events: z.array(MonitorEventSchema),
    next_cursor: z.string().nullish(),
    warnings: z
      .array(
        z
          .object({
            message: z.string(),
            type: z.string(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

// ── Inbound Webhook Payload from Parallel ─────────────────────────────────

// The webhook still wraps an event_group_id — we resolve full event details
// via `client.monitor.events(monitorId, { event_group_id })`.
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
      metadata: z.record(z.string()).optional(),
    }),
  })
  .passthrough();

// ── Derived TypeScript Types ───────────────────────────────────────────────

export type MonitorStatus = z.infer<typeof MonitorStatusSchema>;
export type MonitorType = z.infer<typeof MonitorTypeSchema>;
export type MonitorProcessor = z.infer<typeof MonitorProcessorSchema>;
export type MonitorEventType = z.infer<typeof MonitorEventTypeSchema>;
export type MonitorWebhook = z.infer<typeof MonitorWebhookSchema>;
export type MonitorMetadata = z.infer<typeof MonitorMetadataSchema>;
export type SourcePolicy = z.infer<typeof SourcePolicySchema>;
export type AdvancedMonitorSettings = z.infer<
  typeof AdvancedMonitorSettingsSchema
>;
export type MonitorEventStreamSettings = z.infer<
  typeof MonitorEventStreamSettingsSchema
>;
export type MonitorSnapshotSettings = z.infer<
  typeof MonitorSnapshotSettingsSchema
>;
export type Monitor = z.infer<typeof MonitorSchema>;
export type PaginatedMonitorResponse = z.infer<
  typeof PaginatedMonitorResponseSchema
>;
export type MonitorEventStreamEvent = z.infer<
  typeof MonitorEventStreamEventSchema
>;
export type MonitorSnapshotEvent = z.infer<typeof MonitorSnapshotEventSchema>;
export type MonitorCompletionEvent = z.infer<
  typeof MonitorCompletionEventSchema
>;
export type MonitorErrorEvent = z.infer<typeof MonitorErrorEventSchema>;
export type MonitorEvent = z.infer<typeof MonitorEventSchema>;
export type PaginatedMonitorEvents = z.infer<
  typeof PaginatedMonitorEventsSchema
>;
export type MonitorWebhookPayload = z.infer<typeof MonitorWebhookPayloadSchema>;

// ── Request Types (V1 contract) ────────────────────────────────────────────

export interface MonitorCreateInput {
  type: "event_stream" | "snapshot";
  frequency: string;
  processor?: MonitorProcessor;
  settings: MonitorEventStreamSettings | MonitorSnapshotSettings;
  webhook?: MonitorWebhook;
  metadata?: Record<string, string>;
}

export interface MonitorUpdateInput {
  frequency?: string;
  metadata?: Record<string, string> | null;
  settings?: { advanced_settings?: AdvancedMonitorSettings | null } | null;
  type?: "event_stream" | "snapshot" | null;
  webhook?: MonitorWebhook | null;
}

export interface MonitorListInput {
  cursor?: string;
  limit?: number;
  status?: MonitorStatus[];
  type?: MonitorType[];
}

export interface MonitorEventsInput {
  cursor?: string;
  event_group_id?: string;
  include_completions?: boolean;
  limit?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert legacy cadence ("daily" | "weekly") to a V1 frequency string.
 * Daily monitors poll every 24h; weekly monitors poll every 7d.
 */
export function legacyCadenceToFrequency(
  cadence: "daily" | "weekly",
): string {
  return cadence === "daily" ? "1d" : "7d";
}

/**
 * Per-dimension processor selection: cyber + legal on high-priority vendors
 * get `base` for higher recall on harder queries; everything else stays on
 * `lite` to keep cost and latency down.
 */
export function pickProcessor(
  riskDimension: string,
  priority: string,
): MonitorProcessor {
  if (priority === "high" && (riskDimension === "cyber" || riskDimension === "legal")) {
    return "base";
  }
  return "lite";
}

// Re-export the shared basis types so consumers can import everything from
// one module if they prefer.
export type { BasisEntry, BasisCitation } from "./task-api.js";
export { BasisEntrySchema, BasisCitationSchema } from "./task-api.js";
