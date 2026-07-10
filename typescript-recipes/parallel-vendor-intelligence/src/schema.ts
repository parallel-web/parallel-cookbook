import { isIP } from "node:net";

import { z } from "zod";

import type {
  JsonSchema,
  MonitorCreateParams,
  TaskRunCreateParams,
} from "./parallel-port.js";

export const SPEC_VERSION = 1;
export const RECIPE_METADATA = "vendor-intel";

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const RISK_DIMENSIONS = [
  {
    key: "financial_health",
    label: "Financial health",
    description:
      "Financial stability, funding, solvency, material revenue changes, layoffs, and signs the vendor may be unable to meet its obligations.",
  },
  {
    key: "legal_regulatory",
    label: "Legal and regulatory",
    description:
      "Material litigation, enforcement actions, sanctions, regulatory restrictions, and compliance failures that could affect the vendor relationship.",
  },
  {
    key: "operational_resilience",
    label: "Operational resilience",
    description:
      "Service outages, supply-chain disruptions, business continuity concerns, capacity constraints, and other threats to reliable delivery.",
  },
  {
    key: "leadership_governance",
    label: "Leadership and governance",
    description:
      "Executive or board changes, governance failures, ownership changes, fraud allegations, and leadership instability.",
  },
  {
    key: "esg_reputation",
    label: "ESG and reputation",
    description:
      "Environmental, labor, ethics, public trust, and reputational developments that could create business or stakeholder risk.",
  },
  {
    key: "cybersecurity",
    label: "Cybersecurity",
    description:
      "Security incidents, data breaches, exploited vulnerabilities, privacy failures, and material weaknesses in the vendor's security posture.",
  },
] as const;

export type RiskDimensionKey = (typeof RISK_DIMENSIONS)[number]["key"];
export const EvidenceFieldSchema = z.enum([
  ...RISK_DIMENSIONS.map(({ key }) => key),
  "adverse_events",
]);
export type EvidenceField = z.infer<typeof EvidenceFieldSchema>;

/** Map SDK basis paths such as `cybersecurity.summary` to the report field they support. */
export function evidenceFieldForPath(path: string): EvidenceField | undefined {
  const root = /^[^.[\]]+/.exec(path)?.[0];
  const parsed = EvidenceFieldSchema.safeParse(root);
  return parsed.success ? parsed.data : undefined;
}

const RiskDimensionSchema = z
  .object({
    severity: RiskLevelSchema.describe(
      "Current severity of the strongest supported finding in this risk dimension.",
    ),
    summary: z
      .string()
      .min(1)
      .describe("A concise synthesis of the current evidence for this dimension."),
    findings: z
      .array(z.string().min(1))
      .describe("Specific evidence-backed findings. Return an empty list when none are found."),
  })
  .strict();

const AdverseEventSchema = z
  .object({
    category: z.string().min(1).describe("Short category such as data breach or lawsuit."),
    severity: RiskLevelSchema,
    title: z.string().min(1).describe("Short factual title for the event."),
    summary: z.string().min(1).describe("Why the event matters to a vendor relationship."),
    event_date: z
      .string()
      .regex(/^\d{4}(?:-\d{2})?(?:-\d{2})?$/)
      .optional()
      .describe("Known event date in YYYY, YYYY-MM, or YYYY-MM-DD form."),
  })
  .strict();

const dimensionShape = Object.fromEntries(
  RISK_DIMENSIONS.map((dimension) => [
    dimension.key,
    RiskDimensionSchema.describe(dimension.description),
  ]),
) as Record<RiskDimensionKey, typeof RiskDimensionSchema>;

export const VendorReportSchema = z
  .object({
    ...dimensionShape,
    adverse_events: z
      .array(AdverseEventSchema)
      .describe(
        "Discrete, material adverse events supported by current public evidence. Do not infer an event merely from several medium-risk dimensions.",
      ),
  })
  .strict();

export type VendorReport = z.infer<typeof VendorReportSchema>;

export const ChangeInvestigationSchema = z
  .object({
    what_changed: z.string().min(1),
    confirmed_facts: z.array(z.string().min(1)),
    business_impact: z.string().min(1),
    open_questions: z.array(z.string().min(1)),
  })
  .strict();
export type ChangeInvestigation = z.infer<typeof ChangeInvestigationSchema>;

export function normalizeVendorDomain(value: string): string {
  const candidate = value.trim();
  if (!candidate) {
    throw new Error("Vendor domain cannot be empty.");
  }

  let url: URL;
  try {
    url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
  } catch {
    throw new Error(`Invalid vendor domain or URL: ${value}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Vendor URL must use http or https: ${value}`);
  }
  if (url.username || url.password) {
    throw new Error(`Vendor URL must not contain credentials: ${value}`);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  const validLabels = labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
  if (
    !hostname ||
    hostname.length > 253 ||
    labels.length < 2 ||
    !validLabels ||
    isIP(hostname) !== 0
  ) {
    throw new Error(`Vendor domain must be a valid DNS hostname: ${value}`);
  }

  return hostname;
}

export const VendorSchema = z
  .object({
    name: z.string().trim().min(1),
    domain: z.string().transform(normalizeVendorDomain),
    riskFloor: RiskLevelSchema.optional(),
  })
  .strict();

export type Vendor = z.infer<typeof VendorSchema>;

const VendorTaskInputSchema = z
  .object({
    objective: z.string().min(1),
    vendor_name: z.string().min(1),
    vendor_domain: z.string().min(1),
  })
  .strict();

function asTaskJsonSchema(schema: z.ZodType): JsonSchema {
  return {
    type: "json",
    json_schema: z.toJSONSchema(schema, {
      target: "draft-7",
      unrepresentable: "throw",
    }),
  };
}

export const VENDOR_TASK_INPUT_SCHEMA = asTaskJsonSchema(VendorTaskInputSchema);
export const VENDOR_REPORT_OUTPUT_SCHEMA = asTaskJsonSchema(VendorReportSchema);
export const CHANGE_INVESTIGATION_OUTPUT_SCHEMA = asTaskJsonSchema(
  ChangeInvestigationSchema,
);

/**
 * Build the stable Task contract that a snapshot Monitor will re-run.
 * Volatile values such as the current date intentionally do not appear here.
 */
export function buildBaselineTaskParams(
  vendorInput: Vendor,
  processor: string,
): TaskRunCreateParams {
  const vendor = VendorSchema.parse(vendorInput);

  return {
    input: {
      objective:
        "Research the vendor's current risk posture using public web evidence. Assess every requested dimension, distinguish discrete adverse events from general risk signals, and do not invent findings.",
      vendor_name: vendor.name,
      vendor_domain: vendor.domain,
    },
    processor,
    task_spec: {
      input_schema: VENDOR_TASK_INPUT_SCHEMA,
      output_schema: VENDOR_REPORT_OUTPUT_SCHEMA,
    },
    metadata: {
      recipe: RECIPE_METADATA,
      vendor: vendor.domain,
      spec: SPEC_VERSION,
    },
  };
}

/** Build a focused follow-up request from durable, explicit snapshot context. */
export function buildChangeInvestigationTaskParams(input: {
  vendor: Vendor;
  eventId: string;
  changedFields: readonly EvidenceField[];
  previousReport: VendorReport;
  currentReport: VendorReport;
  previousInteractionId?: string;
  policyDecision: {
    threshold: RiskLevel;
    previousLevel: RiskLevel;
    currentLevel: RiskLevel;
    requiresHumanReview: boolean;
    reasons: readonly unknown[];
  };
  processor: string;
}): TaskRunCreateParams {
  const vendor = VendorSchema.parse(input.vendor);
  const changedFields = z.array(EvidenceFieldSchema).parse(input.changedFields);
  const previousValues = Object.fromEntries(
    changedFields.map((field) => [field, input.previousReport[field]]),
  );
  const currentValues = Object.fromEntries(
    changedFields.map((field) => [field, input.currentReport[field]]),
  );

  return {
    input: {
      objective:
        "Investigate the detected vendor-intelligence change. Confirm what changed, explain its business impact, and identify unresolved questions. Do not choose a vendor action; deterministic policy owns that decision.",
      vendor_name: vendor.name,
      vendor_domain: vendor.domain,
      monitor_event_id: input.eventId,
      changed_fields: changedFields,
      previous_values: previousValues,
      current_values: currentValues,
      policy_decision: input.policyDecision,
    },
    processor: input.processor,
    ...(input.previousInteractionId
      ? { previous_interaction_id: input.previousInteractionId }
      : {}),
    task_spec: {
      output_schema: CHANGE_INVESTIGATION_OUTPUT_SCHEMA,
    },
    metadata: {
      recipe: RECIPE_METADATA,
      vendor: vendor.domain,
      event: input.eventId,
    },
  };
}

export function buildSnapshotMonitorParams(input: {
  vendor: Vendor;
  baselineRunId: string;
  frequency: string;
  processor: "lite" | "base";
}): MonitorCreateParams {
  const vendor = VendorSchema.parse(input.vendor);
  return {
    type: "snapshot",
    frequency: input.frequency,
    processor: input.processor,
    settings: { task_run_id: input.baselineRunId },
    metadata: {
      recipe: RECIPE_METADATA,
      vendor: vendor.domain,
      spec: String(SPEC_VERSION),
    },
  };
}
