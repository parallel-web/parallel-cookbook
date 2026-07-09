import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import {
  EvidenceFieldSchema,
  FollowUpDecisionSchema,
  RiskAssessmentSchema,
} from "./risk-policy.js";
import {
  ChangeInvestigationSchema,
  SPEC_VERSION,
  VendorReportSchema,
  VendorSchema,
} from "./schema.js";

const CitationSchema = z
  .object({
    url: z.string(),
    excerpts: z.array(z.string()).nullable().optional(),
    title: z.string().nullable().optional(),
  });

export const FieldBasisSchema = z
  .object({
    field: z.string(),
    reasoning: z.string(),
    citations: z.array(CitationSchema).optional(),
    confidence: z.string().nullable().optional(),
  });

const BaselineStateSchema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("pending") }),
  z.object({
    stage: z.literal("running"),
    runId: z.string(),
    interactionId: z.string().optional(),
    startedAt: z.string(),
  }),
  z.object({
    stage: z.literal("completed"),
    runId: z.string(),
    interactionId: z.string().optional(),
    report: VendorReportSchema,
    basis: z.array(FieldBasisSchema),
    assessment: RiskAssessmentSchema,
    observedAt: z.string(),
    warnings: z.array(z.string()).optional(),
  }),
]);

const MonitorStateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("active"),
    monitorId: z.string(),
    baselineRunId: z.string(),
    frequency: z.string(),
    processor: z.enum(["lite", "base"]),
    createdAt: z.string(),
    newestObservedEventId: z.string().optional(),
    lastCheckedAt: z.string().optional(),
    reportedExecutionErrors: z.array(z.string()).optional(),
  }),
  z.object({
    status: z.literal("cancelled"),
    monitorId: z.string(),
    baselineRunId: z.string(),
    frequency: z.string(),
    processor: z.enum(["lite", "base"]),
    createdAt: z.string(),
    cancelledAt: z.string(),
  }),
]);

const FollowUpStateSchema = z.object({
  runId: z.string().optional(),
  investigation: ChangeInvestigationSchema.optional(),
  basis: z.array(FieldBasisSchema).optional(),
  completedAt: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

const EventLedgerEntrySchema = z.object({
  eventId: z.string(),
  monitorId: z.string(),
  eventDate: z.string().nullable(),
  eventGroupId: z.string(),
  firstSeenAt: z.string(),
  changedFields: z.array(EvidenceFieldSchema),
  previousReport: VendorReportSchema,
  previousBasis: z.array(FieldBasisSchema),
  previousAssessment: RiskAssessmentSchema,
  currentReport: VendorReportSchema,
  currentBasis: z.array(FieldBasisSchema),
  currentAssessment: RiskAssessmentSchema,
  decision: FollowUpDecisionSchema,
  stage: z.enum(["follow_up_pending", "completed"]),
  followUp: FollowUpStateSchema.optional(),
  completedAt: z.string().optional(),
  lastError: z
    .object({
      message: z.string(),
      at: z.string(),
    })
    .optional(),
});

const LatestAssessmentSchema = z.object({
  report: VendorReportSchema,
  basis: z.array(FieldBasisSchema),
  assessment: RiskAssessmentSchema,
  observedAt: z.string(),
  eventId: z.string().optional(),
});

const VendorStateSchema = z.object({
  vendor: VendorSchema,
  baseline: BaselineStateSchema,
  latest: LatestAssessmentSchema.optional(),
  monitor: MonitorStateSchema.optional(),
  events: z.record(z.string(), EventLedgerEntrySchema),
});

export const RecipeStateSchema = z
  .object({
    stateVersion: z.literal(1),
    specVersion: z.number().int().positive(),
    vendors: z.record(z.string(), VendorStateSchema),
  })
  .superRefine((state, context) => {
    for (const [domain, vendorState] of Object.entries(state.vendors)) {
      if (domain !== vendorState.vendor.domain) {
        context.addIssue({
          code: "custom",
          path: ["vendors", domain, "vendor", "domain"],
          message: `Vendor state key ${domain} does not match normalized domain ${vendorState.vendor.domain}.`,
        });
      }
      if (vendorState.monitor?.status === "active") {
        if (vendorState.baseline.stage !== "completed") {
          context.addIssue({
            code: "custom",
            path: ["vendors", domain, "monitor"],
            message: "An active Monitor requires a completed baseline Task.",
          });
        } else if (vendorState.monitor.baselineRunId !== vendorState.baseline.runId) {
          context.addIssue({
            code: "custom",
            path: ["vendors", domain, "monitor", "baselineRunId"],
            message: "Active Monitor baseline does not match the completed baseline Task.",
          });
        }
      }
      for (const [eventId, event] of Object.entries(vendorState.events)) {
        if (eventId !== event.eventId) {
          context.addIssue({
            code: "custom",
            path: ["vendors", domain, "events", eventId, "eventId"],
            message: "Event map key does not match eventId.",
          });
        }
        if (event.stage === "follow_up_pending" && !event.decision.runFollowUp) {
          context.addIssue({
            code: "custom",
            path: ["vendors", domain, "events", eventId, "stage"],
            message: "A pending follow-up requires a positive follow-up decision.",
          });
        }
        if (
          event.stage === "completed" &&
          !event.completedAt
        ) {
          context.addIssue({
            code: "custom",
            path: ["vendors", domain, "events", eventId, "completedAt"],
            message: "A completed event requires a completion timestamp.",
          });
        }
        if (
          event.stage === "completed" &&
          event.decision.runFollowUp &&
          (!event.completedAt ||
            !event.followUp?.runId ||
            !event.followUp.investigation ||
            !event.followUp.completedAt)
        ) {
          context.addIssue({
            code: "custom",
            path: ["vendors", domain, "events", eventId],
            message: "A completed follow-up requires its run, investigation, and timestamps.",
          });
        }
      }
    }
  });

export type RecipeState = z.infer<typeof RecipeStateSchema>;
export type VendorState = z.infer<typeof VendorStateSchema>;
export type EventLedgerEntry = z.infer<typeof EventLedgerEntrySchema>;

export function emptyRecipeState(): RecipeState {
  return { stateVersion: 1, specVersion: SPEC_VERSION, vendors: {} };
}

export class FileStateStore {
  readonly statePath: string;

  constructor(rootDirectory: string) {
    this.statePath = join(rootDirectory, "state.json");
  }

  async read(): Promise<RecipeState> {
    let raw: string;
    try {
      raw = await readFile(this.statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyRecipeState();
      throw error;
    }

    try {
      return RecipeStateSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new Error(
        `Cannot read vendor intelligence state at ${this.statePath}. Back up and repair the file before running another command.`,
        { cause: error },
      );
    }
  }

  async update(mutator: (state: RecipeState) => void): Promise<RecipeState> {
    const current = await this.read();
    const next = structuredClone(current);
    mutator(next);
    const validated = RecipeStateSchema.parse(next);
    await this.write(validated);
    return validated;
  }

  private async write(state: RecipeState): Promise<void> {
    const directory = dirname(this.statePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.statePath}.tmp-${process.pid}-${randomUUID()}`;

    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporaryPath, this.statePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
