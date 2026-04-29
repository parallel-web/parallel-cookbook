import { z } from "zod";
import { VendorSchema } from "./vendor.js";

// ── Modified Vendor ────────────────────────────────────────────────────────

export const ModifiedVendorSchema = z.object({
  vendor: VendorSchema,
  previous: VendorSchema,
  changes: z.array(z.string()),
});

// ── Vendor Diff ────────────────────────────────────────────────────────────

export const VendorDiffSchema = z.object({
  added: z.array(VendorSchema),
  removed: z.array(VendorSchema),
  unchanged: z.array(VendorSchema),
  modified: z.array(ModifiedVendorSchema),
});

// ── Diff Result ────────────────────────────────────────────────────────────

export const DiffErrorSchema = z.object({
  vendor_domain: z.string(),
  error: z.string(),
});

export const DiffResultSchema = z.object({
  monitors_created: z.map(z.string(), z.array(z.string())),
  monitors_deleted: z.array(z.string()),
  monitors_adjusted: z.array(z.string()),
  errors: z.array(DiffErrorSchema),
});

// ── Derived TypeScript Types ───────────────────────────────────────────────

export type ModifiedVendor = z.infer<typeof ModifiedVendorSchema>;
export type VendorDiff = z.infer<typeof VendorDiffSchema>;
export type DiffError = z.infer<typeof DiffErrorSchema>;
export type DiffResult = z.infer<typeof DiffResultSchema>;
