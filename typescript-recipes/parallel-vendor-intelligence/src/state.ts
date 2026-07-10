import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import type { FieldBasis } from "./parallel-port.js";
import { withCommandLock } from "./command-lock.js";
import { FollowUpDecisionSchema } from "./risk-policy.js";
import {
  ChangeInvestigationSchema,
  RiskLevelSchema,
  SPEC_VERSION,
  VendorReportSchema,
  VendorSchema,
} from "./schema.js";

export const STATE_VERSION = 1;

const CitationSchema = z.object({
  url: z.string(),
  excerpts: z.array(z.string()).nullable().optional(),
  title: z.string().nullable().optional(),
});

export const FieldBasisSchema: z.ZodType<FieldBasis> = z.object({
  field: z.string(),
  reasoning: z.string(),
  citations: z.array(CitationSchema).optional(),
  confidence: z.string().nullable().optional(),
});

const TaskRefSchema = z.object({
  runId: z.string().min(1),
  interactionId: z.string().min(1).optional(),
  startedAt: z.string().min(1).optional(),
});

const TaskFailureSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("remote_terminal"),
    run: TaskRefSchema,
    status: z.enum(["action_required", "failed", "cancelled"]),
    message: z.string().min(1),
    refId: z.string().min(1).optional(),
    failedAt: z.string().min(1),
  }),
  z.object({
    kind: z.literal("invalid_output"),
    run: TaskRefSchema,
    status: z.literal("completed"),
    message: z.string().min(1),
    failedAt: z.string().min(1),
  }),
]);

const FailedAttemptsSchema = z.array(TaskFailureSchema);
const NonEmptyFailedAttemptsSchema = FailedAttemptsSchema.min(1);

const BaselineStateSchema = z.discriminatedUnion("stage", [
  z.object({
    stage: z.literal("not_started"),
    failedAttempts: FailedAttemptsSchema,
  }),
  z.object({
    stage: z.literal("running"),
    run: TaskRefSchema,
    failedAttempts: FailedAttemptsSchema,
  }),
  z.object({
    stage: z.literal("failed"),
    failedAttempts: NonEmptyFailedAttemptsSchema,
  }),
  z.object({
    stage: z.literal("completed"),
    run: TaskRefSchema,
    failedAttempts: FailedAttemptsSchema,
    evidence: z.object({
      report: VendorReportSchema,
      basis: z.array(FieldBasisSchema),
      observedAt: z.string().min(1),
      warnings: z.array(z.string()),
    }),
  }),
]);

const MonitorStateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("active"),
    monitorId: z.string().min(1),
    baselineRunId: z.string().min(1),
    frequency: z.string().min(1),
    processor: z.enum(["lite", "base"]),
    createdAt: z.string().min(1),
    newestObservedEventId: z.string().min(1).optional(),
    lastCheckedAt: z.string().min(1).optional(),
    reportedExecutionErrors: z.array(z.string()).optional(),
  }),
  z.object({
    status: z.literal("cancelled"),
    monitorId: z.string().min(1),
    baselineRunId: z.string().min(1),
    frequency: z.string().min(1),
    processor: z.enum(["lite", "base"]),
    createdAt: z.string().min(1),
    cancelledAt: z.string().min(1),
  }),
]);

const HistoricalDecisionFields = {
  // Historical decisions remain readable when a future policy version is introduced.
  policyVersion: z.number().int().positive(),
  evaluatedAt: z.string().min(1),
  riskFloor: RiskLevelSchema.optional(),
};

export const NoFollowUpDecisionSchema = FollowUpDecisionSchema.extend({
  runFollowUp: z.literal(false),
  ...HistoricalDecisionFields,
});

export const FollowUpRequiredDecisionSchema = FollowUpDecisionSchema.extend({
  runFollowUp: z.literal(true),
  ...HistoricalDecisionFields,
});

const EventEvidenceFields = {
  eventId: z.string().min(1),
  monitorId: z.string().min(1),
  eventDate: z.string().nullable(),
  eventGroupId: z.string().min(1),
  firstSeenAt: z.string().min(1),
  previousReport: VendorReportSchema,
  previousBasis: z.array(FieldBasisSchema),
  currentReport: VendorReportSchema,
  currentBasis: z.array(FieldBasisSchema),
};

const CompletedWithoutFollowUpSchema = z.object({
  stage: z.literal("completed_without_follow_up"),
  ...EventEvidenceFields,
  decision: NoFollowUpDecisionSchema,
  completedAt: z.string().min(1),
});

const FollowUpQueuedSchema = z.object({
  stage: z.literal("follow_up_queued"),
  ...EventEvidenceFields,
  decision: FollowUpRequiredDecisionSchema,
  failedAttempts: FailedAttemptsSchema,
});

const FollowUpRunningSchema = z.object({
  stage: z.literal("follow_up_running"),
  ...EventEvidenceFields,
  decision: FollowUpRequiredDecisionSchema,
  run: TaskRefSchema,
  failedAttempts: FailedAttemptsSchema,
});

const FollowUpFailedSchema = z.object({
  stage: z.literal("follow_up_failed"),
  ...EventEvidenceFields,
  decision: FollowUpRequiredDecisionSchema,
  failedAttempts: NonEmptyFailedAttemptsSchema,
});

const FollowUpCompletedSchema = z.object({
  stage: z.literal("follow_up_completed"),
  ...EventEvidenceFields,
  decision: FollowUpRequiredDecisionSchema,
  run: TaskRefSchema,
  failedAttempts: FailedAttemptsSchema,
  investigation: ChangeInvestigationSchema,
  basis: z.array(FieldBasisSchema),
  warnings: z.array(z.string()),
  completedAt: z.string().min(1),
});

// Failed API payloads are evidence for diagnosis and retry, not trusted domain data.
// Keep the envelope permissive here; reconstruction is the validation boundary.
const RawTaskOutputSchema = z
  .object({
    type: z.unknown(),
    content: z.unknown(),
    basis: z.unknown(),
  })
  .passthrough();

export const RawSnapshotEventSchema = z.object({
  eventId: z.string().min(1),
  eventGroupId: z.string().min(1),
  eventDate: z.string().nullable(),
  previousOutput: RawTaskOutputSchema,
  changedOutput: RawTaskOutputSchema,
});

const EventFailedSchema = z.object({
  stage: z.literal("event_failed"),
  eventId: z.string().min(1),
  monitorId: z.string().min(1),
  eventDate: z.string().nullable(),
  eventGroupId: z.string().min(1),
  firstSeenAt: z.string().min(1),
  rawEvent: RawSnapshotEventSchema,
  failure: z.object({
    kind: z.literal("invalid_event"),
    message: z.string().min(1),
    failedAt: z.string().min(1),
    attempts: z.number().int().positive(),
  }),
});

export const EventLedgerEntrySchema = z.discriminatedUnion("stage", [
  CompletedWithoutFollowUpSchema,
  FollowUpQueuedSchema,
  FollowUpRunningSchema,
  FollowUpFailedSchema,
  FollowUpCompletedSchema,
  EventFailedSchema,
]);

const VendorStateSchema = z.object({
  vendor: VendorSchema,
  baseline: BaselineStateSchema,
  monitor: MonitorStateSchema.optional(),
  events: z.record(z.string(), EventLedgerEntrySchema),
  latestEventId: z.string().min(1).optional(),
});

export const RecipeStateSchema = z
  .object({
    stateVersion: z.literal(STATE_VERSION),
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
        } else if (vendorState.monitor.baselineRunId !== vendorState.baseline.run.runId) {
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
        if (
          event.stage === "event_failed" &&
          (event.rawEvent.eventId !== event.eventId ||
            event.rawEvent.eventGroupId !== event.eventGroupId ||
            event.rawEvent.eventDate !== event.eventDate)
        ) {
          context.addIssue({
            code: "custom",
            path: ["vendors", domain, "events", eventId, "rawEvent"],
            message: "Failed event identity must match its retained raw payload.",
          });
        }
      }
      if (vendorState.latestEventId) {
        const latest = vendorState.events[vendorState.latestEventId];
        if (!latest || latest.stage === "event_failed") {
          context.addIssue({
            code: "custom",
            path: ["vendors", domain, "latestEventId"],
            message: "latestEventId must reference a successfully reconstructed event.",
          });
        }
      }
    }
  });

export type RecipeState = z.infer<typeof RecipeStateSchema>;
export type VendorState = z.infer<typeof VendorStateSchema>;
type EventLedgerEntry = z.infer<typeof EventLedgerEntrySchema>;
export type EventEvidence = Exclude<EventLedgerEntry, { stage: "event_failed" }>;
export type TaskFailure = z.infer<typeof TaskFailureSchema>;
export type TaskRef = z.infer<typeof TaskRefSchema>;
export type RawSnapshotEvent = z.infer<typeof RawSnapshotEventSchema>;

export function emptyRecipeState(): RecipeState {
  return { stateVersion: STATE_VERSION, specVersion: SPEC_VERSION, vendors: {} };
}

export class FileStateStore {
  readonly statePath: string;
  readonly lockPath: string;
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = rootDirectory;
    this.statePath = join(rootDirectory, "state.json");
    this.lockPath = join(rootDirectory, "command.lock");
  }

  async read(): Promise<RecipeState> {
    return this.load();
  }

  async update(mutator: (state: RecipeState) => void): Promise<void> {
    const next = structuredClone(await this.load());
    mutator(next);
    const validated = RecipeStateSchema.parse(next);
    await this.write(validated);
  }

  async withCommandLock<T>(command: string, action: () => Promise<T>): Promise<T> {
    return withCommandLock({
      rootDirectory: this.rootDirectory,
      lockPath: this.lockPath,
      command,
      action,
    });
  }

  private async load(): Promise<RecipeState> {
    let raw: string;
    try {
      raw = await readFile(this.statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyRecipeState();
      }
      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as { stateVersion?: unknown };
      if (parsed.stateVersion !== STATE_VERSION) {
        throw new Error(`Unsupported state version ${String(parsed.stateVersion)}.`);
      }
      return RecipeStateSchema.parse(parsed);
    } catch (error) {
      throw new Error(
        `Cannot read vendor intelligence state at ${this.statePath}. Back up and repair the file before running another command.`,
        { cause: error },
      );
    }
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
