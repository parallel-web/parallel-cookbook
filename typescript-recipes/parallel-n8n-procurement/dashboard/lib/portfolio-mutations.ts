import type { MonitoringPriority, RiskLevel } from "@/lib/dashboard-types";

export const DASHBOARD_MUTATION_URL_ENV = "PROCUREMENT_DASHBOARD_MUTATION_URL";
export const DASHBOARD_WRITE_TOKEN_ENV = "PROCUREMENT_DASHBOARD_WRITE_TOKEN";
export const DASHBOARD_WRITE_TOKEN_HEADER = "x-procurement-dashboard-token";

export type PortfolioMutationAction = "addVendor" | "uploadVendors" | "resetSeedVendors";

export interface PortfolioMutationVendorInput {
  vendorName: string;
  vendorDomain: string;
  vendorCategory: string;
  relationshipOwner: string;
  region: string;
  monitoringPriority: MonitoringPriority;
  riskLevel: RiskLevel;
  score: number;
  nextResearchDate: string;
}

export type PortfolioMutationRequest =
  | { action: "addVendor"; vendor: PortfolioMutationVendorInput }
  | { action: "uploadVendors"; vendors: PortfolioMutationVendorInput[] }
  | { action: "resetSeedVendors" };

export interface PortfolioMutationResponse {
  ok: boolean;
  action?: PortfolioMutationAction;
  affected?: number;
  error?: string;
}

export function isPortfolioMutationRequest(value: unknown): value is PortfolioMutationRequest {
  if (!isRecord(value) || typeof value.action !== "string") return false;

  if (value.action === "resetSeedVendors") return true;

  if (value.action === "addVendor") {
    return isMutationVendor(value.vendor);
  }

  if (value.action === "uploadVendors") {
    return Array.isArray(value.vendors) && value.vendors.length > 0 && value.vendors.every(isMutationVendor);
  }

  return false;
}

function isMutationVendor(value: unknown): value is PortfolioMutationVendorInput {
  if (!isRecord(value)) return false;

  return (
    typeof value.vendorName === "string" &&
    typeof value.vendorDomain === "string" &&
    typeof value.vendorCategory === "string" &&
    typeof value.relationshipOwner === "string" &&
    typeof value.region === "string" &&
    isMonitoringPriority(value.monitoringPriority) &&
    isRiskLevel(value.riskLevel) &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    typeof value.nextResearchDate === "string"
  );
}

function isMonitoringPriority(value: unknown): value is MonitoringPriority {
  return value === "high" || value === "medium" || value === "low";
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
