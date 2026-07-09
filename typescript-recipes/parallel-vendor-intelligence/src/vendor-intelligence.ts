import type { Monitor, MonitorSnapshotEvent } from "parallel-web/resources/monitor";
import type { FieldBasis, TaskRunResult } from "parallel-web/resources/task-run";

import type { ParallelPort } from "./parallel-port.js";
import {
  compareRisk,
  decideFollowUp,
  EvidenceFieldSchema,
  scoreReport,
  type EvidenceField,
  type FollowUpDecision,
  type RiskAssessment,
} from "./risk-policy.js";
import {
  buildBaselineTaskParams,
  buildChangeInvestigationTaskParams,
  ChangeInvestigationSchema,
  SPEC_VERSION,
  VendorReportSchema,
  VendorSchema,
  type RiskLevel,
  type Vendor,
  type VendorReport,
} from "./schema.js";
import {
  FieldBasisSchema,
  type EventLedgerEntry,
  FileStateStore,
  type RecipeState,
} from "./state.js";

const RECIPE_METADATA = "vendor-intel";

export interface VendorIntelligenceConfig {
  monitorFrequency: string;
  followUpRiskThreshold: RiskLevel;
  baselineProcessor: string;
  monitorProcessor: "lite" | "base";
  followUpProcessor: string;
  taskResultPollSeconds: number;
  taskResultMaxWaitMilliseconds: number;
  taskResultRetryDelayMilliseconds: number;
}

export const DEFAULT_CONFIG: VendorIntelligenceConfig = {
  monitorFrequency: "1d",
  followUpRiskThreshold: "HIGH",
  baselineProcessor: "core",
  monitorProcessor: "lite",
  followUpProcessor: "pro",
  taskResultPollSeconds: 25,
  taskResultMaxWaitMilliseconds: 15 * 60 * 1_000,
  taskResultRetryDelayMilliseconds: 250,
};

export interface BootstrapSummary {
  vendors: number;
  baselinesCreated: number;
  baselinesReused: number;
  monitorsCreated: number;
  monitorsAdopted: number;
  monitorsReused: number;
}

export interface CheckSummary {
  monitorsChecked: number;
  newEvents: number;
  followUpDecisions: number;
  followUpTasksCreated: number;
  followUpsCompleted: number;
  humanEscalations: number;
  warnings: string[];
  errors: string[];
}

export interface CleanupSummary {
  attempted: string[];
  cancelled: string[];
  failures: Array<{ monitorId: string; message: string }>;
}

type Logger = Pick<Console, "log" | "warn" | "error">;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function assertCurrentSpec(state: RecipeState): void {
  if (state.specVersion !== SPEC_VERSION) {
    throw new Error(
      `State uses vendor report spec ${state.specVersion}, but this recipe uses ${SPEC_VERSION}. Run cleanup with the old state before resetting it.`,
    );
  }
}

function parseBasis(value: unknown): FieldBasis[] {
  return FieldBasisSchema.array().parse(value ?? []) as FieldBasis[];
}

function isSnapshotEvent(value: unknown): value is MonitorSnapshotEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "event_id" in value &&
    "changed_output" in value &&
    "previous_output" in value
  );
}

function isMonitorError(value: unknown): value is { error_message: string; timestamp: string } {
  return typeof value === "object" && value !== null && "error_message" in value;
}

function isSnapshotMonitorForBaseline(
  monitor: Monitor,
  vendor: Vendor,
  baselineRunId: string,
  frequency: string,
  processor: "lite" | "base",
): boolean {
  return (
    monitor.type === "snapshot" &&
    monitor.status === "active" &&
    "task_run_id" in monitor.settings &&
    monitor.settings.task_run_id === baselineRunId &&
    monitor.frequency === frequency &&
    monitor.processor === processor &&
    monitor.metadata?.recipe === RECIPE_METADATA &&
    monitor.metadata?.vendor === vendor.domain &&
    monitor.metadata?.spec === String(SPEC_VERSION)
  );
}

export function reconstructSnapshotEvent(event: MonitorSnapshotEvent): {
  previousReport: VendorReport;
  currentReport: VendorReport;
  currentBasis: FieldBasis[];
  changedFields: EvidenceField[];
} {
  if (event.previous_output.type !== "json" || event.changed_output.type !== "json") {
    throw new Error(`Snapshot event ${event.event_id} must contain JSON outputs.`);
  }

  const previousReport = VendorReportSchema.parse(event.previous_output.content);
  const changedFields = EvidenceFieldSchema.array().parse(
    Object.keys(event.changed_output.content),
  );
  const currentReport = VendorReportSchema.parse({
    ...event.previous_output.content,
    ...event.changed_output.content,
  });

  const basis = new Map<string, FieldBasis>();
  for (const entry of parseBasis(event.previous_output.basis)) basis.set(entry.field, entry);
  for (const field of changedFields) {
    basis.delete(field);
    for (const existingField of [...basis.keys()]) {
      if (existingField.startsWith(`${field}.`)) basis.delete(existingField);
    }
  }
  for (const entry of parseBasis(event.changed_output.basis)) basis.set(entry.field, entry);

  return {
    previousReport,
    currentReport,
    currentBasis: [...basis.values()],
    changedFields,
  };
}

function taskWarnings(result: TaskRunResult): string[] {
  return (result.run.warnings ?? []).map((warning) => warning.message);
}

export class VendorIntelligence {
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly logger: Logger;

  constructor(
    private readonly options: {
      client: ParallelPort;
      store: FileStateStore;
      config: VendorIntelligenceConfig;
      now?: () => Date;
      sleep?: (milliseconds: number) => Promise<void>;
      logger?: Logger;
    },
  ) {
    this.now = options.now ?? (() => new Date());
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.logger = options.logger ?? console;
  }

  async bootstrap(vendorInputs: Vendor[]): Promise<BootstrapSummary> {
    const vendors = vendorInputs.map((vendor) => VendorSchema.parse(vendor));
    const initial = await this.options.store.read();
    assertCurrentSpec(initial);
    const summary: BootstrapSummary = {
      vendors: vendors.length,
      baselinesCreated: 0,
      baselinesReused: 0,
      monitorsCreated: 0,
      monitorsAdopted: 0,
      monitorsReused: 0,
    };

    for (const vendor of vendors) {
      await this.options.store.update((state) => {
        const existing = state.vendors[vendor.domain];
        if (!existing) {
          state.vendors[vendor.domain] = {
            vendor,
            baseline: { stage: "pending" },
            events: {},
          };
          return;
        }
        if (existing.baseline.stage !== "pending" && existing.vendor.name !== vendor.name) {
          throw new Error(
            `Vendor ${vendor.domain} was bootstrapped as ${existing.vendor.name}; changing its name would diverge from the saved Task input. Restore that name or clean up and reset state.`,
          );
        }
        existing.vendor = vendor;
        if (existing.baseline.stage === "completed") {
          existing.baseline.assessment = scoreReport(
            existing.baseline.report,
            vendor.riskFloor,
            existing.baseline.basis,
          );
        }
        if (existing.latest) {
          existing.latest.assessment = scoreReport(
            existing.latest.report,
            vendor.riskFloor,
            existing.latest.basis,
          );
        }
      });

      let state = await this.options.store.read();
      let vendorState = state.vendors[vendor.domain]!;

      if (vendorState.baseline.stage !== "completed") {
        let runId: string;
        let interactionId: string | undefined;
        if (vendorState.baseline.stage === "running") {
          runId = vendorState.baseline.runId;
          interactionId = vendorState.baseline.interactionId;
        } else {
          const params = buildBaselineTaskParams(vendor);
          const run = await this.options.client.taskRun.create({
            ...params,
            processor: this.options.config.baselineProcessor,
          });
          runId = run.run_id;
          interactionId = run.interaction_id;
          await this.options.store.update((current) => {
            current.vendors[vendor.domain]!.baseline = {
              stage: "running",
              runId,
              interactionId,
              startedAt: this.now().toISOString(),
            };
          });
          summary.baselinesCreated += 1;
        }

        const result = await this.waitForTaskResult(runId);
        if (result.output.type !== "json") {
          throw new Error(`Baseline Task ${runId} returned ${result.output.type}, expected JSON.`);
        }
        const report = VendorReportSchema.parse(result.output.content);
        const basis = parseBasis(result.output.basis);
        const assessment = scoreReport(report, vendor.riskFloor, basis);
        const warnings = taskWarnings(result);
        for (const warning of warnings) this.logger.warn(`Baseline ${runId}: ${warning}`);
        const observedAt = this.now().toISOString();
        await this.options.store.update((current) => {
          const record = current.vendors[vendor.domain]!;
          record.baseline = {
            stage: "completed",
            runId,
            interactionId,
            report,
            basis,
            assessment,
            observedAt,
            ...(warnings.length > 0 ? { warnings } : {}),
          };
          record.latest = { report, basis, assessment, observedAt };
        });
      } else {
        summary.baselinesReused += 1;
      }

      state = await this.options.store.read();
      vendorState = state.vendors[vendor.domain]!;
      if (vendorState.baseline.stage !== "completed") {
        throw new Error(`Baseline for ${vendor.domain} did not reach completed state.`);
      }
      if (vendorState.monitor?.status === "active") {
        const localMonitor = vendorState.monitor;
        const remote = await this.options.client.monitor.retrieve(localMonitor.monitorId);
        if (remote.status === "cancelled") {
          await this.markMonitorCancelled(vendor.domain, localMonitor.monitorId);
        } else if (
          isSnapshotMonitorForBaseline(
            remote,
            vendor,
            vendorState.baseline.runId,
            this.options.config.monitorFrequency,
            this.options.config.monitorProcessor,
          )
        ) {
          summary.monitorsReused += 1;
          continue;
        } else {
          throw new Error(
            `Stored Monitor ${localMonitor.monitorId} no longer matches the baseline, metadata, frequency, or processor. Run cleanup before changing Monitor configuration.`,
          );
        }
      }

      const adopted = await this.findAdoptableMonitor(vendor, vendorState.baseline.runId);
      if (adopted) {
        await this.saveActiveMonitor(vendor, vendorState.baseline.runId, adopted);
        summary.monitorsAdopted += 1;
        continue;
      }

      const monitor = await this.options.client.monitor.create({
        type: "snapshot",
        frequency: this.options.config.monitorFrequency,
        processor: this.options.config.monitorProcessor,
        settings: { task_run_id: vendorState.baseline.runId },
        metadata: {
          recipe: RECIPE_METADATA,
          vendor: vendor.domain,
          spec: String(SPEC_VERSION),
        },
      });
      await this.saveActiveMonitor(vendor, vendorState.baseline.runId, monitor);
      summary.monitorsCreated += 1;
    }

    return summary;
  }

  async checkForUpdates(): Promise<CheckSummary> {
    const initial = await this.options.store.read();
    assertCurrentSpec(initial);
    const summary: CheckSummary = {
      monitorsChecked: 0,
      newEvents: 0,
      followUpDecisions: 0,
      followUpTasksCreated: 0,
      followUpsCompleted: 0,
      humanEscalations: 0,
      warnings: [],
      errors: [],
    };
    const blockedMonitors = new Set<string>();

    for (const [domain, vendorState] of Object.entries(initial.vendors)) {
      const pending = Object.values(vendorState.events).filter(
        (entry) => entry.stage === "follow_up_pending",
      );
      for (const entry of pending) {
        try {
          await this.completeFollowUp(domain, entry.eventId, summary);
        } catch (error) {
          const message = `Could not resume event ${entry.eventId}: ${errorMessage(error)}`;
          summary.errors.push(message);
          this.logger.error(message);
          blockedMonitors.add(entry.monitorId);
          break;
        }
      }
    }

    const refreshed = await this.options.store.read();
    for (const [domain, vendorState] of Object.entries(refreshed.vendors)) {
      const monitor = vendorState.monitor;
      if (!monitor || monitor.status !== "active" || blockedMonitors.has(monitor.monitorId)) {
        continue;
      }
      summary.monitorsChecked += 1;

      try {
        const events: MonitorSnapshotEvent[] = [];
        const seen = new Set<string>();
        const reportedExecutionErrors = new Set(monitor.reportedExecutionErrors ?? []);
        const newExecutionErrorFingerprints: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await this.options.client.monitor.events(monitor.monitorId, {
            limit: 100,
            include_completions: false,
            ...(cursor ? { cursor } : {}),
          });
          for (const warning of page.warnings ?? []) {
            const message = `${monitor.monitorId}: ${warning.message}`;
            summary.warnings.push(message);
            this.logger.warn(message);
          }
          for (const event of page.events) {
            if (isSnapshotEvent(event) && !seen.has(event.event_id)) {
              seen.add(event.event_id);
              events.push(event);
            } else if (isMonitorError(event)) {
              const fingerprint = `${event.timestamp}\u0000${event.error_message}`;
              if (!reportedExecutionErrors.has(fingerprint)) {
                reportedExecutionErrors.add(fingerprint);
                newExecutionErrorFingerprints.push(fingerprint);
                const message = `${monitor.monitorId} execution error: ${event.error_message}`;
                summary.errors.push(message);
                this.logger.error(message);
              }
            }
          }
          cursor = page.next_cursor ?? undefined;
        } while (cursor);

        if (
          monitor.newestObservedEventId &&
          events.length > 0 &&
          !seen.has(monitor.newestObservedEventId)
        ) {
          const message = `${monitor.monitorId}: prior event ${monitor.newestObservedEventId} is outside the retained Monitor history; processing every retained unseen event.`;
          summary.warnings.push(message);
          this.logger.warn(message);
        }

        let newestDurableEventId: string | undefined;
        for (const event of [...events].reverse()) {
          const currentState = await this.options.store.read();
          const existing = currentState.vendors[domain]?.events[event.event_id];
          if (existing?.stage === "completed") {
            newestDurableEventId = event.event_id;
            continue;
          }
          try {
            if (!existing) {
              await this.recordSnapshotEvent(domain, monitor.monitorId, event, summary);
            }
            newestDurableEventId = event.event_id;
            const afterRecord = await this.options.store.read();
            if (afterRecord.vendors[domain]?.events[event.event_id]?.stage === "follow_up_pending") {
              await this.completeFollowUp(domain, event.event_id, summary);
            }
          } catch (error) {
            const message = `Could not process event ${event.event_id}: ${errorMessage(error)}`;
            summary.errors.push(message);
            this.logger.error(message);
            break;
          }
        }

        const durableState = await this.options.store.read();
        const newestDurableEntry = events
          .map((event) => durableState.vendors[domain]?.events[event.event_id])
          .find((entry): entry is EventLedgerEntry => entry !== undefined);
        await this.options.store.update((state) => {
          const record = state.vendors[domain];
          const currentMonitor = record?.monitor;
          if (!record || !currentMonitor || currentMonitor.status !== "active") return;
          currentMonitor.lastCheckedAt = this.now().toISOString();
          if (newestDurableEventId) {
            currentMonitor.newestObservedEventId = newestDurableEventId;
          }
          if (newExecutionErrorFingerprints.length > 0) {
            currentMonitor.reportedExecutionErrors = [
              ...(currentMonitor.reportedExecutionErrors ?? []),
              ...newExecutionErrorFingerprints,
            ].slice(-100);
          }
          if (newestDurableEntry) {
            record.latest = {
              report: newestDurableEntry.currentReport,
              basis: newestDurableEntry.currentBasis,
              assessment: newestDurableEntry.currentAssessment,
              observedAt: newestDurableEntry.firstSeenAt,
              eventId: newestDurableEntry.eventId,
            };
          }
        });
      } catch (error) {
        const message = `Could not check Monitor ${monitor.monitorId}: ${errorMessage(error)}`;
        summary.errors.push(message);
        this.logger.error(message);
      }
    }

    return summary;
  }

  async cleanup(): Promise<CleanupSummary> {
    const state = await this.options.store.read();
    const summary: CleanupSummary = { attempted: [], cancelled: [], failures: [] };

    for (const [domain, vendorState] of Object.entries(state.vendors)) {
      const monitor = vendorState.monitor;
      if (!monitor || monitor.status === "cancelled") continue;
      summary.attempted.push(monitor.monitorId);
      this.logger.log(`Cancelling Monitor ${monitor.monitorId} for ${domain}...`);

      let cancelled = false;
      try {
        await this.options.client.monitor.cancel(monitor.monitorId);
        cancelled = true;
      } catch (cancelError) {
        try {
          const remote = await this.options.client.monitor.retrieve(monitor.monitorId);
          cancelled = remote.status === "cancelled";
        } catch {
          // Preserve the original cancellation error below.
        }
        if (!cancelled) {
          summary.failures.push({
            monitorId: monitor.monitorId,
            message: errorMessage(cancelError),
          });
          continue;
        }
      }

      summary.cancelled.push(monitor.monitorId);
      try {
        await this.markMonitorCancelled(domain, monitor.monitorId);
        this.logger.log(`Cancelled Monitor ${monitor.monitorId}.`);
      } catch (error) {
        summary.failures.push({
          monitorId: monitor.monitorId,
          message: `Remote cancellation succeeded, but local state was not updated: ${errorMessage(error)}`,
        });
      }
    }

    return summary;
  }

  private async waitForTaskResult(runId: string): Promise<TaskRunResult> {
    const deadline = Date.now() + this.options.config.taskResultMaxWaitMilliseconds;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        return await this.options.client.taskRun.result(
          runId,
          { timeout: this.options.config.taskResultPollSeconds },
          { maxRetries: 0 },
        );
      } catch (error) {
        lastError = error;
        if (errorStatus(error) !== 408) throw error;
      }

      if (Date.now() < deadline) {
        await this.sleep(this.options.config.taskResultRetryDelayMilliseconds);
      }
    }

    throw new Error(
      `Task ${runId} did not complete within ${this.options.config.taskResultMaxWaitMilliseconds}ms.`,
      { cause: lastError },
    );
  }

  private async findAdoptableMonitor(
    vendor: Vendor,
    baselineRunId: string,
  ): Promise<Monitor | undefined> {
    const candidates: Monitor[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.options.client.monitor.list({
        limit: 100,
        status: ["active"],
        type: ["snapshot"],
        ...(cursor ? { cursor } : {}),
      });
      candidates.push(
        ...page.monitors.filter((monitor) =>
          isSnapshotMonitorForBaseline(
            monitor,
            vendor,
            baselineRunId,
            this.options.config.monitorFrequency,
            this.options.config.monitorProcessor,
          ),
        ),
      );
      cursor = page.next_cursor ?? undefined;
    } while (cursor);

    if (candidates.length > 1) {
      throw new Error(
        `Multiple active recipe Monitors match ${vendor.domain} and baseline ${baselineRunId}: ${candidates.map(({ monitor_id }) => monitor_id).join(", ")}. Cancel extras before retrying.`,
      );
    }
    return candidates[0];
  }

  private async saveActiveMonitor(
    vendor: Vendor,
    baselineRunId: string,
    monitor: Monitor,
  ): Promise<void> {
    await this.options.store.update((state) => {
      state.vendors[vendor.domain]!.monitor = {
        status: "active",
        monitorId: monitor.monitor_id,
        baselineRunId,
        frequency: monitor.frequency,
        processor: monitor.processor,
        createdAt: monitor.created_at || this.now().toISOString(),
      };
    });
  }

  private async markMonitorCancelled(domain: string, monitorId: string): Promise<void> {
    await this.options.store.update((state) => {
      const record = state.vendors[domain]?.monitor;
      if (!record || record.status !== "active" || record.monitorId !== monitorId) return;
      state.vendors[domain]!.monitor = {
        status: "cancelled",
        monitorId: record.monitorId,
        baselineRunId: record.baselineRunId,
        frequency: record.frequency,
        processor: record.processor,
        createdAt: record.createdAt,
        cancelledAt: this.now().toISOString(),
      };
    });
  }

  private async recordSnapshotEvent(
    domain: string,
    monitorId: string,
    event: MonitorSnapshotEvent,
    summary: CheckSummary,
  ): Promise<void> {
    const state = await this.options.store.read();
    const vendorState = state.vendors[domain];
    if (!vendorState) throw new Error(`No local vendor state for ${domain}.`);
    const reconstructed = reconstructSnapshotEvent(event);
    const previousBasis = parseBasis(
      event.previous_output.type === "json" ? event.previous_output.basis : [],
    );
    const previousAssessment = scoreReport(
      reconstructed.previousReport,
      vendorState.vendor.riskFloor,
      previousBasis,
    );
    const currentAssessment = scoreReport(
      reconstructed.currentReport,
      vendorState.vendor.riskFloor,
      reconstructed.currentBasis,
    );
    const decision = decideFollowUp({
      previousReport: reconstructed.previousReport,
      currentReport: reconstructed.currentReport,
      changedFields: reconstructed.changedFields,
      threshold: this.options.config.followUpRiskThreshold,
      riskFloor: vendorState.vendor.riskFloor,
      previousAssessment,
      currentAssessment,
    });
    const now = this.now().toISOString();
    const entry: EventLedgerEntry = {
      eventId: event.event_id,
      monitorId,
      eventDate: event.event_date,
      eventGroupId: event.event_group_id,
      firstSeenAt: now,
      changedFields: reconstructed.changedFields,
      previousReport: reconstructed.previousReport,
      previousBasis,
      previousAssessment,
      currentReport: reconstructed.currentReport,
      currentBasis: reconstructed.currentBasis,
      currentAssessment,
      decision,
      stage: decision.runFollowUp ? "follow_up_pending" : "completed",
      ...(!decision.runFollowUp ? { completedAt: now } : {}),
    };

    await this.options.store.update((current) => {
      const record = current.vendors[domain]!;
      if (!record.events[event.event_id]) record.events[event.event_id] = entry;
    });
    summary.newEvents += 1;
    if (decision.runFollowUp) summary.followUpDecisions += 1;
    if (
      decision.runFollowUp &&
      (compareRisk(previousAssessment.level, "HIGH") >= 0 ||
        compareRisk(currentAssessment.level, "HIGH") >= 0)
    ) {
      summary.humanEscalations += 1;
    }
  }

  private async completeFollowUp(
    domain: string,
    eventId: string,
    summary: CheckSummary,
  ): Promise<void> {
    const state = await this.options.store.read();
    const vendorState = state.vendors[domain];
    const entry = vendorState?.events[eventId];
    if (!vendorState || !entry) throw new Error(`No pending event ${eventId} for ${domain}.`);
    if (entry.stage === "completed") return;

    let runId = entry.followUp?.runId;
    try {
      if (!runId) {
        const run = await this.options.client.taskRun.create(
          buildChangeInvestigationTaskParams({
            vendor: vendorState.vendor,
            eventId,
            changedFields: entry.changedFields,
            previousReport: entry.previousReport,
            currentReport: entry.currentReport,
            policyDecision: {
              threshold: entry.decision.threshold,
              previousLevel: entry.decision.previousLevel,
              currentLevel: entry.decision.currentLevel,
              requiresHumanReview: entry.decision.requiresHumanReview,
              reasons: entry.decision.reasons,
            },
            processor: this.options.config.followUpProcessor,
          }),
        );
        runId = run.run_id;
        await this.options.store.update((current) => {
          const currentEntry = current.vendors[domain]!.events[eventId]!;
          currentEntry.followUp = { ...currentEntry.followUp, runId };
          delete currentEntry.lastError;
        });
        summary.followUpTasksCreated += 1;
      }

      const result = await this.waitForTaskResult(runId);
      if (result.output.type !== "json") {
        throw new Error(`Follow-up Task ${runId} returned ${result.output.type}, expected JSON.`);
      }
      const investigation = ChangeInvestigationSchema.parse(result.output.content);
      const basis = parseBasis(result.output.basis);
      const warnings = taskWarnings(result);
      for (const warning of warnings) this.logger.warn(`Follow-up ${runId}: ${warning}`);
      const completedAt = this.now().toISOString();
      await this.options.store.update((current) => {
        const currentEntry = current.vendors[domain]!.events[eventId]!;
        currentEntry.followUp = {
          runId,
          investigation,
          basis,
          completedAt,
          ...(warnings.length > 0 ? { warnings } : {}),
        };
        currentEntry.stage = "completed";
        currentEntry.completedAt = completedAt;
        delete currentEntry.lastError;
      });
      summary.followUpsCompleted += 1;
    } catch (error) {
      await this.options.store.update((current) => {
        const currentEntry = current.vendors[domain]!.events[eventId]!;
        currentEntry.lastError = {
          message: errorMessage(error),
          at: this.now().toISOString(),
        };
      });
      throw error;
    }
  }
}
