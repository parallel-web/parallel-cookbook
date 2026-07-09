import type { RiskTier } from "./types";

// ── Severity normalization ─────────────────────────────────────────────
//
// Mirrors `normalizeSeverity` on the src/ side. The Parallel Monitor schema
// constrains severity to LOW/MEDIUM/HIGH/CRITICAL at the Task layer, but a
// monitor that emits text output (or a misconfigured schema) can still ship
// values like "INFO", null, or empty strings. We collapse anything off-enum
// to "LOW" so downstream RECOMMENDATION_MAP / SeverityCounts lookups never
// hand back `undefined`.

const RISK_TIER_SET = new Set<RiskTier>(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export function normalizeSeverity(value: unknown): RiskTier {
  if (typeof value !== "string") return "LOW";
  const upper = value.trim().toUpperCase();
  return RISK_TIER_SET.has(upper as RiskTier) ? (upper as RiskTier) : "LOW";
}
