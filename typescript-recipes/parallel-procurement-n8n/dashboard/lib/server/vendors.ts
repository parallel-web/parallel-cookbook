import "server-only";
import { db } from "./db";
import type { MonitoringPriority } from "@/lib/types/dashboard";

export interface VendorRow {
  id: string;
  account_id: string;
  vendor_name: string;
  vendor_domain: string;
  vendor_category: string;
  relationship_owner: string | null;
  region: string | null;
  monitoring_priority: MonitoringPriority;
  risk_tier_override: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  next_research_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorInput {
  vendorName: string;
  vendorDomain: string;
  vendorCategory?: string;
  relationshipOwner?: string;
  region?: string;
  monitoringPriority?: MonitoringPriority;
  riskTierOverride?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  nextResearchDate?: string;
}

export function normalizeDomain(value: string): string {
  let v = value.trim().toLowerCase();
  if (!v) return v;
  v = v.replace(/^https?:\/\//, "");
  v = v.replace(/^www\./, "");
  v = v.split("/")[0];
  return v;
}

export function normalizeCategory(value: string | undefined | null): string {
  if (!value) return "other";
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

export function normalizePriority(value: string | undefined | null): MonitoringPriority {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

export function defaultNextResearchDate(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export async function listVendorsByAccount(accountId: string): Promise<VendorRow[]> {
  const { data, error } = await db()
    .from("vendors")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as VendorRow[];
}

export async function insertVendor(
  accountId: string,
  input: VendorInput,
): Promise<VendorRow> {
  const row = {
    account_id: accountId,
    vendor_name: input.vendorName.trim(),
    vendor_domain: normalizeDomain(input.vendorDomain),
    vendor_category: normalizeCategory(input.vendorCategory),
    relationship_owner: input.relationshipOwner?.trim() || null,
    region: input.region?.trim() || null,
    monitoring_priority: normalizePriority(input.monitoringPriority),
    risk_tier_override: input.riskTierOverride ?? null,
    next_research_date: input.nextResearchDate ?? defaultNextResearchDate(),
  };
  if (!row.vendor_name) throw new Error("vendor_name is required");
  if (!row.vendor_domain) throw new Error("vendor_domain is required");

  const { data, error } = await db()
    .from("vendors")
    .upsert(row, { onConflict: "account_id,vendor_domain" })
    .select("*")
    .single();
  if (error) throw error;
  return data as VendorRow;
}

export async function updateVendor(
  accountId: string,
  vendorId: string,
  patch: Partial<VendorInput>,
): Promise<VendorRow> {
  const update: Record<string, unknown> = {};
  if (patch.vendorName !== undefined) update.vendor_name = patch.vendorName.trim();
  if (patch.vendorDomain !== undefined) update.vendor_domain = normalizeDomain(patch.vendorDomain);
  if (patch.vendorCategory !== undefined) update.vendor_category = normalizeCategory(patch.vendorCategory);
  if (patch.relationshipOwner !== undefined) update.relationship_owner = patch.relationshipOwner?.trim() || null;
  if (patch.region !== undefined) update.region = patch.region?.trim() || null;
  if (patch.monitoringPriority !== undefined) update.monitoring_priority = normalizePriority(patch.monitoringPriority);
  if (patch.riskTierOverride !== undefined) update.risk_tier_override = patch.riskTierOverride;
  if (patch.nextResearchDate !== undefined) update.next_research_date = patch.nextResearchDate;

  const { data, error } = await db()
    .from("vendors")
    .update(update)
    .eq("account_id", accountId)
    .eq("id", vendorId)
    .select("*")
    .single();
  if (error) throw error;
  return data as VendorRow;
}

export async function deleteVendor(accountId: string, vendorId: string): Promise<void> {
  const { error } = await db()
    .from("vendors")
    .delete()
    .eq("account_id", accountId)
    .eq("id", vendorId);
  if (error) throw error;
}

// ── CSV / paste-list parsing ────────────────────────────────────────────

function csvCells(line: string): string[] {
  return line
    .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
    .map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

/**
 * Parse either a header-bearing CSV (vendorName, vendorDomain, ...) or a
 * naive "Name, domain[, category]" line list. Returns one VendorInput per
 * row.
 */
export function parseVendorList(text: string): VendorInput[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const headerCandidates = csvCells(lines[0]).map((h) => h.toLowerCase());
  const looksLikeHeader = headerCandidates.some((h) =>
    ["vendorname", "name", "vendor"].includes(h.replace(/\s+/g, "")),
  );

  const inputs: VendorInput[] = [];
  if (looksLikeHeader) {
    const headers = headerCandidates;
    for (const line of lines.slice(1)) {
      const cells = csvCells(line);
      const row = Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
      const name = row.vendorname || row.name || row.vendor;
      if (!name) continue;
      inputs.push({
        vendorName: name,
        vendorDomain: row.vendordomain || row.domain || row.website || `${slugFromName(name)}.com`,
        vendorCategory: row.vendorcategory || row.category || "other",
        relationshipOwner: row.relationshipowner || row.owner,
        region: row.region,
        monitoringPriority: normalizePriority(row.monitoringpriority || row.priority),
        riskTierOverride: row.risktieroverride
          ? (row.risktieroverride.toUpperCase() as VendorInput["riskTierOverride"])
          : undefined,
        nextResearchDate: row.nextresearchdate || row.next || undefined,
      });
    }
  } else {
    for (const line of lines) {
      const cells = csvCells(line);
      const name = cells[0];
      if (!name) continue;
      const domainCandidate = cells[1] || `${slugFromName(name)}.com`;
      inputs.push({
        vendorName: name,
        vendorDomain: domainCandidate,
        vendorCategory: cells[2] || "other",
        monitoringPriority: cells[3] ? normalizePriority(cells[3]) : "medium",
      });
    }
  }
  return inputs;
}

function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32) || "vendor";
}
