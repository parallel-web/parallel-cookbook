import type { Citation, Confidence } from "../types";

// Short, human hostname for a source chip, e.g. "crunchbase.com".
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  inferred: "Inferred",
};

// Total citation count across a set (used for the count badge).
export function countCitations(citations: Citation[]): number {
  return citations.length;
}

// Render an array value (investors, tech stack) as a readable string.
export function joinList(value: string[] | null): string {
  return value && value.length ? value.join(", ") : "";
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
