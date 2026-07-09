import type { FieldBasis } from "parallel-web/resources/task-run";
import { z } from "zod";

import {
  RISK_DIMENSIONS,
  RiskLevelSchema,
  type RiskDimensionKey,
  type RiskLevel,
  type VendorReport,
} from "./schema.js";

const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

const GUIDANCE = {
  LOW: "continue_monitoring",
  MEDIUM: "analyst_review",
  HIGH: "urgent_human_review",
  CRITICAL: "immediate_human_escalation",
} as const;

export const EvidenceFieldSchema = z.enum([
  ...RISK_DIMENSIONS.map(({ key }) => key),
  "adverse_events",
]);
export type EvidenceField = z.infer<typeof EvidenceFieldSchema>;

const SeverityCountsSchema = z.object({
  LOW: z.number().int().nonnegative(),
  MEDIUM: z.number().int().nonnegative(),
  HIGH: z.number().int().nonnegative(),
  CRITICAL: z.number().int().nonnegative(),
});

const RiskReasonSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("dimension"),
    field: EvidenceFieldSchema.exclude(["adverse_events"]),
    level: RiskLevelSchema,
  }),
  z.object({
    kind: z.literal("adverse_event"),
    title: z.string(),
    level: RiskLevelSchema,
  }),
  z.object({
    kind: z.literal("vendor_floor"),
    level: RiskLevelSchema,
    applied: z.boolean(),
  }),
]);

const DisplayCitationSchema = z.object({
  field: EvidenceFieldSchema,
  url: z.string(),
  title: z.string().nullable().optional(),
  excerpts: z.array(z.string()).nullable().optional(),
  reasoning: z.string(),
  confidence: z.string().nullable().optional(),
});

export const RiskAssessmentSchema = z.object({
  level: RiskLevelSchema,
  evidenceLevel: RiskLevelSchema,
  adverseDetected: z.boolean(),
  requiresHumanReview: z.boolean(),
  guidance: z.enum([
    "continue_monitoring",
    "analyst_review",
    "urgent_human_review",
    "immediate_human_escalation",
  ]),
  dimensionCounts: SeverityCountsSchema,
  evidenceFields: z.array(EvidenceFieldSchema),
  reasons: z.array(RiskReasonSchema),
  citations: z.array(DisplayCitationSchema),
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

const FollowUpReasonSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("changed_dimension"),
    field: EvidenceFieldSchema.exclude(["adverse_events"]),
    previousLevel: RiskLevelSchema,
    currentLevel: RiskLevelSchema,
  }),
  z.object({
    kind: z.literal("changed_adverse_event"),
    title: z.string(),
    previousLevel: RiskLevelSchema.optional(),
    currentLevel: RiskLevelSchema.optional(),
  }),
  z.object({
    kind: z.literal("vendor_floor"),
    level: RiskLevelSchema,
  }),
]);

export const FollowUpDecisionSchema = z.object({
  runFollowUp: z.boolean(),
  threshold: RiskLevelSchema,
  previousLevel: RiskLevelSchema,
  currentLevel: RiskLevelSchema,
  changedFields: z.array(EvidenceFieldSchema),
  requiresHumanReview: z.boolean(),
  reasons: z.array(FollowUpReasonSchema),
});
export type FollowUpDecision = z.infer<typeof FollowUpDecisionSchema>;

export function compareRisk(left: RiskLevel, right: RiskLevel): number {
  return RISK_ORDER[left] - RISK_ORDER[right];
}

function maxRisk(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>(
    (highest, level) => (compareRisk(level, highest) > 0 ? level : highest),
    "LOW",
  );
}

function basisField(entry: FieldBasis): EvidenceField | undefined {
  return RISK_DIMENSIONS.some(({ key }) => key === entry.field)
    ? (entry.field as RiskDimensionKey)
    : entry.field === "adverse_events"
      ? "adverse_events"
      : undefined;
}

export function selectCitations(
  basis: FieldBasis[] = [],
  fields: readonly EvidenceField[],
): RiskAssessment["citations"] {
  const wanted = new Set(fields);
  const seen = new Set<string>();
  const citations: RiskAssessment["citations"] = [];

  for (const entry of basis) {
    const field = basisField(entry);
    if (!field || !wanted.has(field)) continue;

    for (const citation of entry.citations ?? []) {
      if (seen.has(citation.url)) continue;
      seen.add(citation.url);
      citations.push({
        field,
        url: citation.url,
        ...(citation.title !== undefined ? { title: citation.title } : {}),
        ...(citation.excerpts !== undefined ? { excerpts: citation.excerpts } : {}),
        reasoning: entry.reasoning,
        ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
      });
    }
  }

  return citations;
}

export function scoreReport(
  report: VendorReport,
  riskFloor?: RiskLevel,
  basis: FieldBasis[] = [],
): RiskAssessment {
  const dimensionCounts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  const reasons: RiskAssessment["reasons"] = [];
  const evidenceFields: EvidenceField[] = [];
  const dimensionLevels: RiskLevel[] = [];

  for (const { key } of RISK_DIMENSIONS) {
    const level = report[key].severity;
    dimensionCounts[level] += 1;
    dimensionLevels.push(level);
    if (level !== "LOW") {
      evidenceFields.push(key);
      reasons.push({ kind: "dimension", field: key, level });
    }
  }

  const adverseLevels = report.adverse_events.map(({ severity }) => severity);
  for (const event of report.adverse_events) {
    reasons.push({ kind: "adverse_event", title: event.title, level: event.severity });
  }
  if (report.adverse_events.length > 0) evidenceFields.push("adverse_events");

  const evidenceLevel = maxRisk([...dimensionLevels, ...adverseLevels]);
  const level = maxRisk([evidenceLevel, riskFloor ?? "LOW"]);
  if (riskFloor) {
    reasons.push({
      kind: "vendor_floor",
      level: riskFloor,
      applied: compareRisk(riskFloor, evidenceLevel) > 0,
    });
  }

  const adverseDetected = report.adverse_events.length > 0;
  const requiresHumanReview = compareRisk(level, "MEDIUM") >= 0 || adverseDetected;

  return RiskAssessmentSchema.parse({
    level,
    evidenceLevel,
    adverseDetected,
    requiresHumanReview,
    guidance: adverseDetected && level === "LOW" ? "analyst_review" : GUIDANCE[level],
    dimensionCounts,
    evidenceFields,
    reasons,
    citations: selectCitations(basis, evidenceFields),
  });
}

function eventIdentity(event: VendorReport["adverse_events"][number]): string {
  return JSON.stringify([
    event.category.trim().toLowerCase(),
    event.title.trim().toLowerCase(),
    event.event_date ?? null,
  ]);
}

export function decideFollowUp(input: {
  previousReport: VendorReport;
  currentReport: VendorReport;
  changedFields: readonly string[];
  threshold: RiskLevel;
  riskFloor?: RiskLevel;
  previousAssessment?: RiskAssessment;
  currentAssessment?: RiskAssessment;
}): FollowUpDecision {
  const changedFields = z.array(EvidenceFieldSchema).parse(input.changedFields);
  const previousAssessment =
    input.previousAssessment ?? scoreReport(input.previousReport, input.riskFloor);
  const currentAssessment =
    input.currentAssessment ?? scoreReport(input.currentReport, input.riskFloor);
  const reasons: FollowUpDecision["reasons"] = [];

  for (const { key } of RISK_DIMENSIONS) {
    if (!changedFields.includes(key)) continue;
    const previousLevel = input.previousReport[key].severity;
    const currentLevel = input.currentReport[key].severity;
    if (
      compareRisk(previousLevel, input.threshold) >= 0 ||
      compareRisk(currentLevel, input.threshold) >= 0
    ) {
      reasons.push({ kind: "changed_dimension", field: key, previousLevel, currentLevel });
    }
  }

  if (changedFields.includes("adverse_events")) {
    const previous = new Map(
      input.previousReport.adverse_events.map((event) => [eventIdentity(event), event]),
    );
    const current = new Map(
      input.currentReport.adverse_events.map((event) => [eventIdentity(event), event]),
    );

    for (const identity of new Set([...previous.keys(), ...current.keys()])) {
      const previousEvent = previous.get(identity);
      const currentEvent = current.get(identity);
      if (
        previousEvent &&
        currentEvent &&
        previousEvent.severity === currentEvent.severity &&
        previousEvent.summary === currentEvent.summary
      ) {
        continue;
      }
      if (
        (previousEvent && compareRisk(previousEvent.severity, input.threshold) >= 0) ||
        (currentEvent && compareRisk(currentEvent.severity, input.threshold) >= 0)
      ) {
        reasons.push({
          kind: "changed_adverse_event",
          title: currentEvent?.title ?? previousEvent!.title,
          ...(previousEvent ? { previousLevel: previousEvent.severity } : {}),
          ...(currentEvent ? { currentLevel: currentEvent.severity } : {}),
        });
      }
    }
  }

  if (
    changedFields.length > 0 &&
    input.riskFloor &&
    compareRisk(input.riskFloor, input.threshold) >= 0
  ) {
    reasons.push({ kind: "vendor_floor", level: input.riskFloor });
  }

  return FollowUpDecisionSchema.parse({
    runFollowUp: reasons.length > 0,
    threshold: input.threshold,
    previousLevel: previousAssessment.level,
    currentLevel: currentAssessment.level,
    changedFields,
    requiresHumanReview:
      reasons.length > 0 &&
      (previousAssessment.requiresHumanReview || currentAssessment.requiresHumanReview),
    reasons,
  });
}
