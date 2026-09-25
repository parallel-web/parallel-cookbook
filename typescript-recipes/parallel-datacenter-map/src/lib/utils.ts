import type { DatacenterStatus, DisplayStatus } from "./types";
import { STATUS_MAP } from "./constants";

export function toDisplayStatus(status: DatacenterStatus): DisplayStatus {
  return STATUS_MAP[status] || "unknown";
}

export function formatNumber(n: number): string {
  if (n === 0) return "—";
  return n.toLocaleString("en-US");
}

export function formatPower(mw: number): string {
  if (mw === 0) return "—";
  if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${mw.toFixed(1)} MW`;
}

export function formatSqft(sqft: number): string {
  if (sqft === 0) return "—";
  if (sqft >= 1000000) return `${(sqft / 1000000).toFixed(1)}M sq ft`;
  return `${formatNumber(Math.round(sqft))} sq ft`;
}

/**
 * Relative label for a DATE-ONLY value (e.g. a monitor event_date like
 * "2026-07-05"). Monitor events carry no time component, so we only claim
 * day-level precision — never fake "hours ago" from a bare date.
 */
export function relativeDate(dateStr: string): string {
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return dateStr;
  const now = new Date();
  const dayMs = 86_400_000;
  const a = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((b - a) / dayMs);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks}w ago`;
}

export function classifyCategory(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("power") || lower.includes("grid") || lower.includes("energy") || lower.includes("substation") || lower.includes("interconnection") || lower.includes("utility"))
    return "POWER & GRID";
  if (lower.includes("ownership") || lower.includes("acquisition") || lower.includes("sale") || lower.includes("acquire"))
    return "OWNERSHIP";
  if (lower.includes("new site") || lower.includes("rumor") || lower.includes("land assembl") || lower.includes("newly disclosed"))
    return "NEW SITE";
  if (lower.includes("permit") || lower.includes("zoning") || lower.includes("rezoning") || lower.includes("approval"))
    return "PERMITS";
  if (lower.includes("expansion") || lower.includes("construction") || lower.includes("build"))
    return "EXPANSION";
  if (lower.includes("community") || lower.includes("opposition") || lower.includes("moratori"))
    return "COMMUNITY";
  if (lower.includes("water"))
    return "WATER";
  if (lower.includes("policy") || lower.includes("legislation") || lower.includes("regulation"))
    return "POLICY";
  return "PERMITS";
}
