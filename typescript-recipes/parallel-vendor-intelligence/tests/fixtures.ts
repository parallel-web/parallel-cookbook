import type {
  FieldBasis,
  MonitorSnapshotEvent,
  SnapshotMonitor,
  TaskRun,
  TaskRunResult,
} from "../src/parallel-port.js";

import {
  RISK_DIMENSIONS,
  type ChangeInvestigation,
  type RiskLevel,
  type VendorReport,
} from "../src/schema.js";

export function vendorReport(
  levels: Partial<Record<(typeof RISK_DIMENSIONS)[number]["key"], RiskLevel>> = {},
  adverseEvents: VendorReport["adverse_events"] = [],
): VendorReport {
  return Object.fromEntries([
    ...RISK_DIMENSIONS.map(({ key }) => [
      key,
      {
        severity: levels[key] ?? "LOW",
        summary: `${key} summary`,
        findings: levels[key] && levels[key] !== "LOW" ? [`${key} finding`] : [],
      },
    ]),
    ["adverse_events", adverseEvents],
  ]) as VendorReport;
}

export function basis(field: string, url = `https://example.com/${field}`): FieldBasis {
  return {
    field,
    reasoning: `${field} reasoning`,
    confidence: "high",
    citations: [{ url, title: `${field} source`, excerpts: [`${field} excerpt`] }],
  };
}

export function taskRun(runId = "run-1"): TaskRun {
  return {
    run_id: runId,
    interaction_id: `interaction-${runId}`,
    status: "queued",
  };
}

export function reportResult(report: VendorReport, runId = "run-1"): TaskRunResult {
  return {
    run: { ...taskRun(runId), status: "completed" },
    output: {
      type: "json",
      content: report,
      basis: [basis("cybersecurity")],
    },
  };
}

export const investigation: ChangeInvestigation = {
  what_changed: "A material security event changed the assessment.",
  confirmed_facts: ["The event is confirmed by public reporting."],
  business_impact: "A human should assess exposure and contingency plans.",
  open_questions: ["Does the incident affect shared data?"],
};

export function investigationResult(runId = "follow-1"): TaskRunResult {
  return {
    run: { ...taskRun(runId), status: "completed" },
    output: {
      type: "json",
      content: investigation,
      basis: [basis("what_changed")],
    },
  };
}

export function snapshotMonitor(
  monitorId = "monitor-1",
  baselineRunId = "run-1",
  status: "active" | "cancelled" = "active",
): SnapshotMonitor {
  return {
    monitor_id: monitorId,
    type: "snapshot",
    status,
    processor: "lite",
    frequency: "1d",
    created_at: "2026-07-09T00:00:00.000Z",
    settings: {
      query: "vendor query",
      task_run_id: baselineRunId,
    },
    metadata: {
      recipe: "vendor-intel",
      vendor: "example.com",
      spec: "1",
    },
  };
}

export function snapshotEvent(input: {
  eventId: string;
  previous: VendorReport;
  changed: Partial<VendorReport>;
  previousBasis?: FieldBasis[];
  changedBasis?: FieldBasis[];
  eventDate?: string;
}): MonitorSnapshotEvent {
  return {
    event_id: input.eventId,
    event_group_id: `group-${input.eventId}`,
    event_date: input.eventDate ?? "2026-07-09",
    previous_output: {
      type: "json",
      content: input.previous,
      basis: input.previousBasis ?? [],
    },
    changed_output: {
      type: "json",
      content: input.changed,
      basis: input.changedBasis ?? [],
    },
  };
}
