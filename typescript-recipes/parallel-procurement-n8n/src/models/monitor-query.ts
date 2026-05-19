import { z } from "zod";
import {
  MonitorFrequencySchema,
  MonitorProcessorSchema,
} from "./monitor-api.js";
import { VendorSchema } from "./vendor.js";

// ── Risk Dimension ─────────────────────────────────────────────────────────

export const RiskDimensionSchema = z.enum([
  "legal",
  "cyber",
  "financial",
  "leadership",
  "esg",
]);

// ── Monitor Query Set ──────────────────────────────────────────────────────

// Per-vendor, per-dimension monitor recipe. `frequency` replaces the legacy
// "daily" | "weekly" cadence — the V1 Monitor API accepts strings like
// "1d", "7d", "12h". `processor` is the lite/base tier hint.
export const MonitorQuerySetSchema = z.object({
  query: z.string(),
  risk_dimension: RiskDimensionSchema,
  frequency: MonitorFrequencySchema,
  processor: MonitorProcessorSchema,
  monitor_category: z.string(),
});

// ── Monitor Registry Entry ─────────────────────────────────────────────────

export const MonitorRegistryEntrySchema = z.object({
  monitor_id: z.string(),
  vendor_domain: z.string(),
  risk_dimension: RiskDimensionSchema,
});

// ── Reconcile Result ───────────────────────────────────────────────────────

export const ReconcileResultSchema = z.object({
  to_create: z.array(
    z.object({
      vendor: VendorSchema,
      queries: z.array(MonitorQuerySetSchema),
    }),
  ),
  to_delete: z.array(
    z.object({
      vendor_domain: z.string(),
      monitor_ids: z.array(z.string()),
    }),
  ),
  unchanged: z.array(
    z.object({
      vendor_domain: z.string(),
    }),
  ),
});

// ── Derived TypeScript Types ───────────────────────────────────────────────

export type RiskDimension = z.infer<typeof RiskDimensionSchema>;
export type MonitorQuerySet = z.infer<typeof MonitorQuerySetSchema>;
export type MonitorRegistryEntry = z.infer<typeof MonitorRegistryEntrySchema>;
export type ReconcileResult = z.infer<typeof ReconcileResultSchema>;
