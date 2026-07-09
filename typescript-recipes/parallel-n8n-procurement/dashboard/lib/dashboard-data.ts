import type { DashboardData, RiskLevel, VendorProfile } from "@/lib/dashboard-types";

export const DASHBOARD_SNAPSHOT_ENV = "PROCUREMENT_DASHBOARD_SNAPSHOT_URL";

export type DashboardDataLoadResult =
  | { ok: true; data: DashboardData }
  | { ok: false; message: string; detail?: string };

export async function loadDashboardData(): Promise<DashboardDataLoadResult> {
  const snapshotUrl = process.env[DASHBOARD_SNAPSHOT_ENV]?.trim();

  if (!snapshotUrl) {
    return {
      ok: false,
      message: "Dashboard snapshot endpoint is not configured.",
      detail: `Set ${DASHBOARD_SNAPSHOT_ENV} to the n8n procurement-dashboard-snapshot webhook URL.`,
    };
  }

  try {
    new URL(snapshotUrl);
  } catch {
    return {
      ok: false,
      message: "Dashboard snapshot endpoint is not a valid URL.",
      detail: `${DASHBOARD_SNAPSHOT_ENV} must be an absolute http(s) URL.`,
    };
  }

  try {
    const response = await fetch(snapshotUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        ok: false,
        message: "Dashboard snapshot endpoint returned an error.",
        detail: `n8n responded with HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as unknown;
    return validateDashboardData(payload);
  } catch (error) {
    return {
      ok: false,
      message: "Dashboard snapshot endpoint could not be reached.",
      detail: error instanceof Error ? error.message : "Unknown fetch failure.",
    };
  }
}

function validateDashboardData(payload: unknown): DashboardDataLoadResult {
  if (!isRecord(payload)) {
    return invalid("Snapshot response must be a JSON object.");
  }

  const data = payload as Partial<DashboardData>;
  const requiredArrays = ["metrics", "riskDistribution", "feed", "actionQueue", "vendors"] as const;
  const missingArray = requiredArrays.find((key) => !Array.isArray(data[key]));

  if (typeof data.lastUpdated !== "string") {
    return invalid("Snapshot response is missing lastUpdated.");
  }

  if (missingArray) {
    return invalid(`Snapshot response is missing ${missingArray}.`);
  }

  if (!isRecord(data.researchSummary)) {
    return invalid("Snapshot response is missing researchSummary.");
  }

  if (!isRecord(data.health)) {
    return invalid("Snapshot response is missing health.");
  }

  const invalidVendor = data.vendors?.find((vendor) => !isVendorProfile(vendor));
  if (invalidVendor) {
    return invalid(`Snapshot contains an invalid vendor profile near ${vendorLabel(invalidVendor)}.`);
  }

  const invalidRiskBand = data.riskDistribution?.find(
    (band) => !isRecord(band) || !isRiskLevel(band.label) || typeof band.count !== "number",
  );
  if (invalidRiskBand) {
    return invalid("Snapshot contains an invalid riskDistribution entry.");
  }

  return { ok: true, data: data as DashboardData };
}

function invalid(detail: string): DashboardDataLoadResult {
  return {
    ok: false,
    message: "Dashboard snapshot response is invalid.",
    detail,
  };
}

function isVendorProfile(value: unknown): value is VendorProfile {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.vendorName === "string" &&
    typeof value.vendorDomain === "string" &&
    typeof value.vendorCategory === "string" &&
    isRiskLevel(value.riskLevel) &&
    isRiskLevel(value.overallRiskLevel) &&
    typeof value.score === "number" &&
    typeof value.actionRequired === "boolean" &&
    Array.isArray(value.dimensions) &&
    Array.isArray(value.adverseEvents) &&
    Array.isArray(value.evidence) &&
    Array.isArray(value.monitors)
  );
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function vendorLabel(value: unknown) {
  return isRecord(value) && typeof value.vendorName === "string" ? value.vendorName : "unknown vendor";
}
