import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────────────────

export const VendorCategorySchema = z.enum([
  "technology",
  "financial_services",
  "manufacturing",
  "healthcare",
  "professional_services",
  "other",
]);

export const RiskTierSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const MonitoringPrioritySchema = z.enum(["high", "medium", "low"]);

// ── Vendor Schema ──────────────────────────────────────────────────────────

export const VendorSchema = z.object({
  vendor_name: z.string().min(1, "vendor_name is required"),
  vendor_domain: z.string().url("vendor_domain must be a valid URL"),
  vendor_category: VendorCategorySchema,
  risk_tier_override: RiskTierSchema.optional(),
  active: z.boolean().default(true),
  monitoring_priority: MonitoringPrioritySchema,
  next_research_date: z
    .string()
    .datetime({ message: "next_research_date must be an ISO date string" })
    .optional(),
  monitor_ids: z.array(z.string()).optional(),
  last_synced_at: z
    .string()
    .datetime({ message: "last_synced_at must be an ISO timestamp" })
    .optional(),
});

// ── Vendor Registry Schema ─────────────────────────────────────────────────

export const VendorRegistrySchema = z.object({
  vendors: z.array(VendorSchema),
  last_sync_timestamp: z.string().datetime().optional(),
  total_count: z.number().int().nonnegative(),
});

// ── Derived TypeScript Types ───────────────────────────────────────────────

export type VendorCategory = z.infer<typeof VendorCategorySchema>;
export type RiskTier = z.infer<typeof RiskTierSchema>;
export type MonitoringPriority = z.infer<typeof MonitoringPrioritySchema>;
export type Vendor = z.infer<typeof VendorSchema>;
export type VendorRegistry = z.infer<typeof VendorRegistrySchema>;
