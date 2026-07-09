import type {
  FieldBasis,
  Monitor,
  MonitorErrorEvent,
  MonitorSnapshotEvent,
  ParallelPort,
  SnapshotMonitor,
  TaskRunResult,
} from "./parallel-port.js";
import {
  decideFollowUp,
  POLICY_VERSION,
  scoreReport,
  type RiskAssessment,
} from "./risk-policy.js";
import {
  buildBaselineTaskParams,
  buildChangeInvestigationTaskParams,
  buildSnapshotMonitorParams,
  ChangeInvestigationSchema,
  normalizeVendorDomain,
  RECIPE_METADATA,
  SPEC_VERSION,
  VendorReportSchema,
  VendorSchema,
  type ChangeInvestigation,
  type EvidenceField,
  type Vendor,
  type VendorReport,
} from "./schema.js";
import {
  EventLedgerEntrySchema,
  FieldBasisSchema,
  FollowUpRequiredDecisionSchema,
  NoFollowUpDecisionSchema,
  type EventEvidence,
  FileStateStore,
  type RecipeState,
  type TaskFailure,
  type TaskRef,
  type VendorState,
} from "./state.js";
import {
  InvalidSnapshotEventError,
  rawSnapshotEvent,
  reconstructSnapshotEvent,
  restoredSnapshotEvent,
  type SnapshotEventInput,
} from "./snapshot-events.js";
import { InvalidTaskOutputError, TaskRunner } from "./task-runner.js";
import {
  VendorIntelligenceConfigSchema,
  type VendorIntelligenceConfig,
} from "./vendor-config.js";

export interface Diagnostic {
  code: string;
  message: string;
  vendor?: string;
  resourceId?: string;
}

export interface AssessmentView {
  source:
    | { kind: "baseline"; runId: string }
    | {
        kind: "monitor_event";
        monitorId: string;
        eventId: string;
        eventDate: string | null;
      };
  observedAt: string;
  report: VendorReport;
  basis: FieldBasis[];
  risk: RiskAssessment & { policyVersion: number };
}

export interface BootstrapSummary {
  vendors: number;
  baselinesCreated: number;
  baselinesResumed: number;
  baselinesReused: number;
  monitorsCreated: number;
  monitorsAdopted: number;
  monitorsReused: number;
  results: Array<{
    vendor: Vendor;
    baseline: {
      action: "created" | "resumed" | "reused";
      runId: string;
      interactionId?: string;
      warnings: string[];
    };
    monitor: {
      action: "created" | "adopted" | "reused";
      monitorId: string;
      frequency: string;
      processor: "lite" | "base";
    };
    assessment: AssessmentView;
  }>;
  omittedActiveVendors: Array<{ vendor: string; monitorId: string }>;
  warnings: Diagnostic[];
}

export type FollowUpView =
  | { status: "not_required" }
  | { status: "pending"; runId?: string }
  | {
      status: "completed";
      runId: string;
      investigation: ChangeInvestigation;
      basis: FieldBasis[];
      warnings: string[];
    }
  | {
      status: "failed";
      runId: string;
      message: string;
      failedAt: string;
    };

export interface ChangeView {
  vendor: Vendor;
  event: {
    monitorId: string;
    eventId: string;
    eventDate: string | null;
    changedFields: EvidenceField[];
  };
  assessment: AssessmentView;
  decision: EventEvidence["decision"];
  followUp: FollowUpView;
}

export interface CheckSummary {
  monitorsChecked: number;
  newEvents: number;
  followUpDecisions: number;
  followUpTasksCreated: number;
  followUpsCompleted: number;
  humanReviewsRequired: number;
  changes: ChangeView[];
  warnings: Diagnostic[];
  errors: Diagnostic[];
}

export interface CleanupSummary {
  scope: { kind: "all" } | { kind: "vendors"; vendors: string[] };
  monitors: Array<
    | { vendor: string; monitorId: string; status: "cancelled" | "already_cancelled" }
    | { vendor: string; monitorId: string; status: "failed"; message: string }
  >;
  warnings: Diagnostic[];
}

type Reporter = (message: string) => void;
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function assertCurrentSpec(state: RecipeState): void {
  if (state.specVersion !== SPEC_VERSION) {
    throw new Error(
      `State uses vendor report spec ${state.specVersion}, but this recipe uses ${SPEC_VERSION}. Run cleanup with the old state before resetting it.`,
    );
  }
}

function parseTaskBasis(value: unknown, taskLabel: string): FieldBasis[] {
  try {
    return FieldBasisSchema.array().parse(value ?? []);
  } catch (error) {
    throw new InvalidTaskOutputError(
      `${taskLabel} returned an invalid evidence basis: ${errorMessage(error)}`,
      { cause: error },
    );
  }
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

function isMonitorError(value: unknown): value is MonitorErrorEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "error_message" in value &&
    "timestamp" in value
  );
}

function isSnapshotMonitorForBaseline(
  monitor: Monitor,
  vendor: Vendor,
  baselineRunId: string,
  frequency: string,
  processor: "lite" | "base",
): monitor is SnapshotMonitor {
  return (
    monitor.type === "snapshot" &&
    monitor.status === "active" &&
    monitor.settings.task_run_id === baselineRunId &&
    monitor.frequency === frequency &&
    monitor.processor === processor &&
    monitor.metadata?.recipe === RECIPE_METADATA &&
    monitor.metadata?.vendor === vendor.domain &&
    monitor.metadata?.spec === String(SPEC_VERSION)
  );
}

function taskWarnings(result: TaskRunResult): string[] {
  return (result.run.warnings ?? []).map((warning) => warning.message);
}

function lastFailure(entry: { failedAttempts: TaskFailure[] }): TaskFailure {
  const failure = entry.failedAttempts.at(-1);
  if (!failure) throw new Error("Failed state is missing its Task failure.");
  return failure;
}

export class VendorIntelligence {
  private readonly client: ParallelPort;
  private readonly store: FileStateStore;
  private readonly config: VendorIntelligenceConfig;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly report: Reporter;
  private readonly tasks: TaskRunner;

  constructor(options: {
    client: ParallelPort;
    store: FileStateStore;
    config: VendorIntelligenceConfig;
    now?: () => Date;
    sleep?: (milliseconds: number) => Promise<void>;
    reporter?: Reporter;
  }) {
    this.client = options.client;
    this.store = options.store;
    this.config = VendorIntelligenceConfigSchema.parse(options.config);
    this.now = options.now ?? (() => new Date());
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.report = options.reporter ?? ((message) => console.error(message));
    this.tasks = new TaskRunner({
      client: this.client,
      pollSeconds: this.config.taskResultPollSeconds,
      maxWaitMilliseconds: this.config.taskResultMaxWaitMilliseconds,
      retryDelayMilliseconds: this.config.taskResultRetryDelayMilliseconds,
      now: this.now,
      sleep: this.sleep,
    });
  }

  async bootstrap(
    vendorInputs: Vendor[],
    options: { retryFailed?: boolean } = {},
  ): Promise<BootstrapSummary> {
    return this.store.withCommandLock("bootstrap", () =>
      this.bootstrapUnlocked(vendorInputs, options),
    );
  }

  async checkForUpdates(
    options: { retryFailed?: boolean } = {},
  ): Promise<CheckSummary> {
    return this.store.withCommandLock("check-updates", () =>
      this.checkForUpdatesUnlocked(options),
    );
  }

  async cleanup(options: { vendors?: string[] } = {}): Promise<CleanupSummary> {
    return this.store.withCommandLock("cleanup", () => this.cleanupUnlocked(options));
  }

  private async bootstrapUnlocked(
    vendorInputs: Vendor[],
    options: { retryFailed?: boolean },
  ): Promise<BootstrapSummary> {
    const vendors = vendorInputs.map((vendor) => VendorSchema.parse(vendor));
    if (vendors.length === 0) throw new Error("Provide at least one vendor to bootstrap.");
    const domains = new Set<string>();
    for (const vendor of vendors) {
      if (domains.has(vendor.domain)) {
        throw new Error(`Vendor input contains duplicate normalized domain ${vendor.domain}.`);
      }
      domains.add(vendor.domain);
    }

    const initial = await this.store.read();
    assertCurrentSpec(initial);
    const summary: BootstrapSummary = {
      vendors: vendors.length,
      baselinesCreated: 0,
      baselinesResumed: 0,
      baselinesReused: 0,
      monitorsCreated: 0,
      monitorsAdopted: 0,
      monitorsReused: 0,
      results: [],
      omittedActiveVendors: [],
      warnings: [],
    };

    for (const [domain, saved] of Object.entries(initial.vendors)) {
      if (!domains.has(domain) && saved.monitor?.status === "active") {
        summary.omittedActiveVendors.push({
          vendor: domain,
          monitorId: saved.monitor.monitorId,
        });
        summary.warnings.push({
          code: "omitted_active_vendor",
          vendor: domain,
          resourceId: saved.monitor.monitorId,
          message: `${domain} remains monitored because bootstrap is additive. Run cleanup -- --vendor ${domain} to cancel its state-owned Monitor.`,
        });
      }
    }

    for (const vendor of vendors) {
      await this.upsertVendor(vendor);
      const baseline = await this.ensureBaseline(vendor, options.retryFailed === true, summary);
      const monitor = await this.ensureMonitor(vendor, baseline.run.runId, summary);
      const completed = (await this.store.read()).vendors[vendor.domain]!.baseline;
      if (completed.stage !== "completed") {
        throw new Error(`Baseline for ${vendor.domain} did not reach completed state.`);
      }
      summary.results.push({
        vendor,
        baseline: {
          action: baseline.action,
          runId: completed.run.runId,
          ...(completed.run.interactionId
            ? { interactionId: completed.run.interactionId }
            : {}),
          warnings: completed.evidence.warnings,
        },
        monitor: {
          action: monitor.action,
          monitorId: monitor.monitor.monitor_id,
          frequency: monitor.monitor.frequency,
          processor: monitor.monitor.processor,
        },
        assessment: this.assessmentView(
          vendor,
          { kind: "baseline", runId: completed.run.runId },
          completed.evidence.report,
          completed.evidence.basis,
          completed.evidence.observedAt,
        ),
      });
    }

    return summary;
  }

  private async upsertVendor(vendor: Vendor): Promise<void> {
    await this.store.update((state) => {
      const existing = state.vendors[vendor.domain];
      if (!existing) {
        state.vendors[vendor.domain] = {
          vendor,
          baseline: { stage: "not_started", failedAttempts: [] },
          events: {},
        };
        return;
      }
      if (existing.baseline.stage !== "not_started" && existing.vendor.name !== vendor.name) {
        throw new Error(
          `Vendor ${vendor.domain} was bootstrapped as ${existing.vendor.name}; changing its name would diverge from the saved Task input. Restore that name or clean up and reset state.`,
        );
      }
      existing.vendor = vendor;
    });
  }

  private async ensureBaseline(
    vendor: Vendor,
    retryFailed: boolean,
    summary: BootstrapSummary,
  ): Promise<{ run: TaskRef; action: "created" | "resumed" | "reused" }> {
    let baseline = (await this.store.read()).vendors[vendor.domain]!.baseline;
    if (baseline.stage === "completed") {
      summary.baselinesReused += 1;
      return { run: baseline.run, action: "reused" };
    }
    if (baseline.stage === "failed" && !retryFailed) {
      const failure = lastFailure(baseline);
      throw new Error(
        `Baseline Task ${failure.run.runId} failed permanently: ${failure.message}. Re-run bootstrap with --retry-failed to create a replacement Task.`,
      );
    }

    let run: TaskRef;
    let action: "created" | "resumed";
    const failedAttempts = baseline.failedAttempts;
    if (baseline.stage === "running") {
      run = baseline.run;
      action = "resumed";
      summary.baselinesResumed += 1;
      this.report(`Resuming baseline Task ${run.runId} for ${vendor.domain}...`);
    } else {
      const created = await this.client.taskRun.create(
        buildBaselineTaskParams(vendor, this.config.baselineProcessor),
        { maxRetries: 0 },
      );
      run = {
        runId: created.run_id,
        interactionId: created.interaction_id,
        startedAt: this.now().toISOString(),
      };
      await this.store.update((state) => {
        state.vendors[vendor.domain]!.baseline = {
          stage: "running",
          run,
          failedAttempts,
        };
      });
      action = "created";
      summary.baselinesCreated += 1;
      this.report(`Created baseline Task ${run.runId} for ${vendor.domain}; waiting...`);
    }

    try {
      const result = await this.tasks.wait(run.runId);
      if (result.run.run_id !== run.runId || result.run.status !== "completed") {
        throw new InvalidTaskOutputError(
          `Baseline Task ${run.runId} returned an inconsistent completed result.`,
        );
      }
      if (result.output.type !== "json") {
        throw new InvalidTaskOutputError(
          `Baseline Task ${run.runId} returned ${result.output.type}, expected JSON.`,
        );
      }
      let report: VendorReport;
      try {
        report = VendorReportSchema.parse(result.output.content);
      } catch (error) {
        throw new InvalidTaskOutputError(
          `Baseline Task ${run.runId} returned invalid vendor intelligence: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      const basis = parseTaskBasis(result.output.basis, `Baseline Task ${run.runId}`);
      const warnings = taskWarnings(result);
      const completedRun: TaskRef = {
        ...run,
        interactionId: result.run.interaction_id || run.interactionId,
      };
      const observedAt = this.now().toISOString();
      await this.store.update((state) => {
        state.vendors[vendor.domain]!.baseline = {
          stage: "completed",
          run: completedRun,
          failedAttempts,
          evidence: { report, basis, observedAt, warnings },
        };
      });
      for (const warning of warnings) this.report(`Baseline ${run.runId}: ${warning}`);
      return { run: completedRun, action };
    } catch (error) {
      const failure = this.tasks.failure(error, run);
      if (failure) {
        await this.store.update((state) => {
          state.vendors[vendor.domain]!.baseline = {
            stage: "failed",
            failedAttempts: [...failedAttempts, failure],
          };
        });
        throw new Error(
          `Baseline Task ${run.runId} failed permanently: ${failure.message}. Re-run bootstrap with --retry-failed to create a replacement Task.`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async ensureMonitor(
    vendor: Vendor,
    baselineRunId: string,
    summary: BootstrapSummary,
  ): Promise<{
    monitor: SnapshotMonitor;
    action: "created" | "adopted" | "reused";
  }> {
    let vendorState = (await this.store.read()).vendors[vendor.domain]!;
    if (vendorState.monitor?.status === "active") {
      const local = vendorState.monitor;
      const remote = await this.client.monitor.retrieve(local.monitorId);
      if (remote.status === "cancelled") {
        await this.markMonitorCancelled(vendor.domain, local.monitorId);
      } else if (
        isSnapshotMonitorForBaseline(
          remote,
          vendor,
          baselineRunId,
          this.config.monitorFrequency,
          this.config.monitorProcessor,
        )
      ) {
        summary.monitorsReused += 1;
        return { monitor: remote, action: "reused" };
      } else {
        throw new Error(
          `Stored Monitor ${local.monitorId} no longer matches the baseline, metadata, frequency, or processor. Run cleanup before changing Monitor configuration.`,
        );
      }
    }

    const adopted = await this.findAdoptableMonitor(vendor, baselineRunId);
    if (adopted) {
      await this.saveActiveMonitor(vendor, baselineRunId, adopted);
      summary.monitorsAdopted += 1;
      return { monitor: adopted, action: "adopted" };
    }

    let monitor: SnapshotMonitor;
    try {
      monitor = await this.client.monitor.create(
        buildSnapshotMonitorParams({
          vendor,
          baselineRunId,
          frequency: this.config.monitorFrequency,
          processor: this.config.monitorProcessor,
        }),
        { maxRetries: 0 },
      );
    } catch (createError) {
      try {
        const recovered = await this.findAdoptableMonitor(vendor, baselineRunId);
        if (recovered) {
          await this.saveActiveMonitor(vendor, baselineRunId, recovered);
          summary.monitorsAdopted += 1;
          this.report(
            `Recovered snapshot Monitor ${recovered.monitor_id} after an ambiguous create response.`,
          );
          return { monitor: recovered, action: "adopted" };
        }
      } catch (recoveryError) {
        throw new Error(
          `Monitor creation for ${vendor.domain} failed and recovery could not list matching Monitors. Re-run bootstrap; it will adopt a matching Monitor before creating another. Recovery error: ${errorMessage(recoveryError)}`,
          { cause: createError },
        );
      }
      throw new Error(
        `Monitor creation for ${vendor.domain} did not return a confirmed response. Re-run bootstrap; it will adopt any matching Monitor before creating another.`,
        { cause: createError },
      );
    }
    const createdMonitor: Monitor = monitor;
    if (
      !isSnapshotMonitorForBaseline(
        createdMonitor,
        vendor,
        baselineRunId,
        this.config.monitorFrequency,
        this.config.monitorProcessor,
      )
    ) {
      let cancellation = "Automatic cancellation failed; cancel it manually.";
      try {
        const cancelled = await this.client.monitor.cancel(monitor.monitor_id);
        const confirmed =
          cancelled.status === "cancelled"
            ? cancelled
            : await this.client.monitor.retrieve(monitor.monitor_id);
        if (confirmed.status === "cancelled") {
          cancellation = "The mismatched Monitor was cancelled automatically.";
        }
      } catch {
        try {
          const confirmed = await this.client.monitor.retrieve(monitor.monitor_id);
          if (confirmed.status === "cancelled") {
            cancellation = "The mismatched Monitor was already cancelled remotely.";
          }
        } catch {
          // The error below retains the known Monitor ID for manual recovery.
        }
      }
      throw new Error(
        `Created Monitor ${monitor.monitor_id} did not match the requested baseline, metadata, frequency, or processor and was not saved. ${cancellation}`,
      );
    }
    await this.saveActiveMonitor(vendor, baselineRunId, monitor);
    summary.monitorsCreated += 1;
    this.report(`Created snapshot Monitor ${monitor.monitor_id} for ${vendor.domain}.`);
    return { monitor, action: "created" };
  }

  private async checkForUpdatesUnlocked(options: {
    retryFailed?: boolean;
  }): Promise<CheckSummary> {
    const initial = await this.store.read();
    assertCurrentSpec(initial);
    const summary: CheckSummary = {
      monitorsChecked: 0,
      newEvents: 0,
      followUpDecisions: 0,
      followUpTasksCreated: 0,
      followUpsCompleted: 0,
      humanReviewsRequired: 0,
      changes: [],
      warnings: [],
      errors: [],
    };
    const blockedMonitors = new Set<string>();

    for (const [domain, vendorState] of Object.entries(initial.vendors)) {
      for (const entry of Object.values(vendorState.events)) {
        try {
          if (entry.stage === "event_failed") {
            if (options.retryFailed) {
              await this.retryFailedEvent(domain, entry.eventId, summary);
            } else {
              this.addDiagnostic(summary.errors, {
                code: "event_requires_retry",
                vendor: domain,
                resourceId: entry.eventId,
                message: `Event ${entry.eventId} could not be validated. Re-run check-updates with --retry-failed after correcting the cause.`,
              });
            }
          } else if (entry.stage === "follow_up_failed") {
            if (options.retryFailed) {
              await this.queueFailedFollowUp(domain, entry.eventId);
              await this.completeFollowUp(domain, entry.eventId, summary);
            } else {
              this.upsertChange(vendorState.vendor, entry, summary);
              const failure = lastFailure(entry);
              this.addDiagnostic(summary.errors, {
                code: "follow_up_requires_retry",
                vendor: domain,
                resourceId: failure.run.runId,
                message: `Follow-up Task ${failure.run.runId} failed permanently. Re-run check-updates with --retry-failed to create a replacement Task.`,
              });
            }
          } else if (
            entry.stage === "follow_up_queued" ||
            entry.stage === "follow_up_running"
          ) {
            await this.completeFollowUp(domain, entry.eventId, summary);
          }
        } catch (error) {
          const message = `Could not resume event ${entry.eventId}: ${errorMessage(error)}`;
          this.addDiagnostic(summary.errors, {
            code: "event_resume_failed",
            vendor: domain,
            resourceId: entry.eventId,
            message,
          });
          const currentEntry = (await this.store.read()).vendors[domain]?.events[
            entry.eventId
          ];
          if (
            (currentEntry?.stage === "follow_up_queued" ||
              currentEntry?.stage === "follow_up_running") &&
            vendorState.monitor?.status === "active"
          ) {
            blockedMonitors.add(vendorState.monitor.monitorId);
          }
          break;
        }
      }
    }

    const refreshed = await this.store.read();
    for (const [domain, vendorState] of Object.entries(refreshed.vendors)) {
      const monitor = vendorState.monitor;
      if (!monitor || monitor.status !== "active" || blockedMonitors.has(monitor.monitorId)) {
        continue;
      }
      summary.monitorsChecked += 1;
      try {
        await this.checkMonitor(domain, monitor, summary);
      } catch (error) {
        this.addDiagnostic(summary.errors, {
          code: "monitor_check_failed",
          vendor: domain,
          resourceId: monitor.monitorId,
          message: `Could not check Monitor ${monitor.monitorId}: ${errorMessage(error)}`,
        });
      }
    }

    summary.humanReviewsRequired = summary.changes.filter(
      ({ assessment }) => assessment.risk.requiresHumanReview,
    ).length;
    return summary;
  }

  private async checkMonitor(
    domain: string,
    monitor: Extract<NonNullable<VendorState["monitor"]>, { status: "active" }>,
    summary: CheckSummary,
  ): Promise<void> {
    const history = await this.fetchMonitorHistory(domain, monitor.monitorId, summary);
    if (monitor.newestObservedEventId && !history.seen.has(monitor.newestObservedEventId)) {
      this.addDiagnostic(summary.warnings, {
        code: "monitor_history_gap",
        vendor: domain,
        resourceId: monitor.monitorId,
        message: `${monitor.monitorId}: prior event ${monitor.newestObservedEventId} is outside retained Monitor history; processing every retained unseen event.`,
      });
    }

    let newestDurableEventId: string | undefined;
    for (const event of [...history.events].reverse()) {
      const currentState = await this.store.read();
      const existing = currentState.vendors[domain]?.events[event.event_id];
      if (existing) {
        newestDurableEventId = event.event_id;
        continue;
      }

      try {
        const recorded = await this.recordSnapshotEvent(
          domain,
          monitor.monitorId,
          event,
          summary,
          true,
        );
        newestDurableEventId = event.event_id;
        if (recorded.stage === "follow_up_queued") {
          await this.completeFollowUp(domain, event.event_id, summary);
        }
      } catch (error) {
        if (error instanceof InvalidSnapshotEventError) {
          await this.recordFailedSnapshotEvent(domain, monitor.monitorId, event, error);
          newestDurableEventId = event.event_id;
          this.addDiagnostic(summary.errors, {
            code: "invalid_snapshot_event",
            vendor: domain,
            resourceId: event.event_id,
            message: error.message,
          });
          summary.newEvents += 1;
          continue;
        }
        this.addDiagnostic(summary.errors, {
          code: "event_processing_failed",
          vendor: domain,
          resourceId: event.event_id,
          message: `Could not process event ${event.event_id}: ${errorMessage(error)}`,
        });
        break;
      }
    }

    const durable = await this.store.read();
    const newestValid = history.events
      .map((event) => durable.vendors[domain]?.events[event.event_id])
      .find(
        (entry): entry is EventEvidence => entry !== undefined && entry.stage !== "event_failed",
      );
    await this.store.update((state) => {
      const record = state.vendors[domain];
      const currentMonitor = record?.monitor;
      if (!record || !currentMonitor || currentMonitor.status !== "active") return;
      currentMonitor.lastCheckedAt = this.now().toISOString();
      if (newestDurableEventId) currentMonitor.newestObservedEventId = newestDurableEventId;
      if (history.newErrorFingerprints.length > 0) {
        currentMonitor.reportedExecutionErrors = [
          ...history.newErrorFingerprints,
          ...(currentMonitor.reportedExecutionErrors ?? []),
        ].filter((value, index, values) => values.indexOf(value) === index).slice(0, 100);
      }
      if (newestValid) record.latestEventId = newestValid.eventId;
    });
  }

  private async fetchMonitorHistory(
    domain: string,
    monitorId: string,
    summary: CheckSummary,
  ): Promise<{
    events: MonitorSnapshotEvent[];
    seen: Set<string>;
    newErrorFingerprints: string[];
  }> {
    const state = await this.store.read();
    const monitor = state.vendors[domain]?.monitor;
    const previouslyReported = new Set(
      monitor?.status === "active" ? monitor.reportedExecutionErrors ?? [] : [],
    );
    const seenThisFetch = new Set<string>();
    const events: MonitorSnapshotEvent[] = [];
    const seen = new Set<string>();
    const newErrorFingerprints: string[] = [];
    let reachedKnownExecutionError = false;
    const cursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.client.monitor.events(monitorId, {
        limit: 100,
        include_completions: false,
        ...(cursor ? { cursor } : {}),
      });
      for (const warning of page.warnings ?? []) {
        this.addDiagnostic(summary.warnings, {
          code: "monitor_warning",
          vendor: domain,
          resourceId: monitorId,
          message: `${monitorId}: ${warning.message}`,
        });
      }
      for (const event of page.events) {
        if (isSnapshotEvent(event) && !seen.has(event.event_id)) {
          seen.add(event.event_id);
          events.push(event);
        } else if (isMonitorError(event)) {
          const fingerprint = `${event.timestamp}\u0000${event.error_message}`;
          if (previouslyReported.has(fingerprint)) {
            reachedKnownExecutionError = true;
          } else if (!reachedKnownExecutionError && !seenThisFetch.has(fingerprint)) {
            seenThisFetch.add(fingerprint);
            newErrorFingerprints.push(fingerprint);
            this.addDiagnostic(summary.errors, {
              code: "monitor_execution_error",
              vendor: domain,
              resourceId: monitorId,
              message: `${monitorId} execution error: ${event.error_message}`,
            });
          }
        }
      }
      const next = page.next_cursor ?? undefined;
      if (next && cursors.has(next)) {
        throw new Error(`Monitor ${monitorId} returned a repeated pagination cursor.`);
      }
      if (next) cursors.add(next);
      cursor = next;
    } while (cursor);

    return { events, seen, newErrorFingerprints };
  }

  private async recordSnapshotEvent(
    domain: string,
    monitorId: string,
    event: SnapshotEventInput,
    summary: CheckSummary,
    countAsNew: boolean,
    firstSeenAt?: string,
  ): Promise<EventEvidence> {
    const state = await this.store.read();
    const vendorState = state.vendors[domain];
    if (!vendorState) throw new Error(`No local vendor state for ${domain}.`);
    const reconstructed = reconstructSnapshotEvent(event);
    const previousAssessment = scoreReport(
      reconstructed.previousReport,
      vendorState.vendor.riskFloor,
      reconstructed.previousBasis,
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
      threshold: this.config.followUpRiskThreshold,
      riskFloor: vendorState.vendor.riskFloor,
      previousAssessment,
      currentAssessment,
    });
    const evaluatedAt = this.now().toISOString();
    const firstObservedAt = firstSeenAt ?? evaluatedAt;
    const historicalDecision = decision.runFollowUp
      ? FollowUpRequiredDecisionSchema.parse({
          ...decision,
          policyVersion: POLICY_VERSION,
          evaluatedAt,
          ...(vendorState.vendor.riskFloor
            ? { riskFloor: vendorState.vendor.riskFloor }
            : {}),
        })
      : NoFollowUpDecisionSchema.parse({
          ...decision,
          policyVersion: POLICY_VERSION,
          evaluatedAt,
          ...(vendorState.vendor.riskFloor
            ? { riskFloor: vendorState.vendor.riskFloor }
            : {}),
        });
    const common = {
      eventId: event.event_id,
      monitorId,
      eventDate: event.event_date,
      eventGroupId: event.event_group_id,
      firstSeenAt: firstObservedAt,
      previousReport: reconstructed.previousReport,
      previousBasis: reconstructed.previousBasis,
      currentReport: reconstructed.currentReport,
      currentBasis: reconstructed.currentBasis,
    };
    const entry = EventLedgerEntrySchema.parse(
      decision.runFollowUp
        ? {
            stage: "follow_up_queued",
            ...common,
            decision: historicalDecision,
            failedAttempts: [],
          }
        : {
            stage: "completed_without_follow_up",
            ...common,
            decision: historicalDecision,
            completedAt: evaluatedAt,
          },
    ) as EventEvidence;

    await this.store.update((current) => {
      const existing = current.vendors[domain]!.events[event.event_id];
      if (!existing || existing.stage === "event_failed") {
        current.vendors[domain]!.events[event.event_id] = entry;
      }
    });
    this.upsertChange(vendorState.vendor, entry, summary);
    if (countAsNew) summary.newEvents += 1;
    if (countAsNew && decision.runFollowUp) summary.followUpDecisions += 1;
    return entry;
  }

  private async recordFailedSnapshotEvent(
    domain: string,
    monitorId: string,
    event: MonitorSnapshotEvent,
    error: InvalidSnapshotEventError,
  ): Promise<void> {
    const now = this.now().toISOString();
    const failed = EventLedgerEntrySchema.parse({
      stage: "event_failed",
      eventId: event.event_id,
      monitorId,
      eventDate: event.event_date,
      eventGroupId: event.event_group_id,
      firstSeenAt: now,
      rawEvent: rawSnapshotEvent(event),
      failure: {
        kind: "invalid_event",
        message: error.message,
        failedAt: now,
        attempts: 1,
      },
    });
    await this.store.update((state) => {
      if (!state.vendors[domain]!.events[event.event_id]) {
        state.vendors[domain]!.events[event.event_id] = failed;
      }
    });
  }

  private async retryFailedEvent(
    domain: string,
    eventId: string,
    summary: CheckSummary,
  ): Promise<void> {
    const state = await this.store.read();
    const entry = state.vendors[domain]?.events[eventId];
    if (!entry || entry.stage !== "event_failed") return;
    try {
      const restored = restoredSnapshotEvent(entry.rawEvent);
      const recorded = await this.recordSnapshotEvent(
        domain,
        entry.monitorId,
        restored,
        summary,
        false,
        entry.firstSeenAt,
      );
      await this.advanceLatestIfCurrentlyObserved(domain, recorded);
      if (recorded.stage === "follow_up_queued") {
        await this.completeFollowUp(domain, eventId, summary);
      }
    } catch (error) {
      if (!(error instanceof InvalidSnapshotEventError)) throw error;
      await this.store.update((current) => {
        const failed = current.vendors[domain]?.events[eventId];
        if (!failed || failed.stage !== "event_failed") return;
        failed.failure = {
          ...failed.failure,
          message: error.message,
          failedAt: this.now().toISOString(),
          attempts: failed.failure.attempts + 1,
        };
      });
      this.addDiagnostic(summary.errors, {
        code: "invalid_snapshot_event",
        vendor: domain,
        resourceId: eventId,
        message: error.message,
      });
    }
  }

  private async queueFailedFollowUp(domain: string, eventId: string): Promise<void> {
    await this.store.update((state) => {
      const entry = state.vendors[domain]?.events[eventId];
      if (!entry || entry.stage !== "follow_up_failed") return;
      state.vendors[domain]!.events[eventId] = EventLedgerEntrySchema.parse({
        ...entry,
        stage: "follow_up_queued",
      });
    });
  }

  private async advanceLatestIfCurrentlyObserved(
    domain: string,
    candidate: EventEvidence,
  ): Promise<void> {
    await this.store.update((state) => {
      const vendor = state.vendors[domain];
      if (!vendor) return;
      if (
        vendor.monitor?.status === "active" &&
        vendor.monitor.newestObservedEventId === candidate.eventId
      ) {
        vendor.latestEventId = candidate.eventId;
      }
    });
  }

  private async completeFollowUp(
    domain: string,
    eventId: string,
    summary: CheckSummary,
  ): Promise<void> {
    let state = await this.store.read();
    const vendorState = state.vendors[domain];
    let entry = vendorState?.events[eventId];
    if (!vendorState || !entry || entry.stage === "event_failed") {
      throw new Error(`No follow-up event ${eventId} for ${domain}.`);
    }
    if (
      entry.stage === "completed_without_follow_up" ||
      entry.stage === "follow_up_completed" ||
      entry.stage === "follow_up_failed"
    ) {
      this.upsertChange(vendorState.vendor, entry, summary);
      return;
    }

    let run: TaskRef;
    if (entry.stage === "follow_up_running") {
      run = entry.run;
      this.report(`Resuming follow-up Task ${run.runId} for event ${eventId}...`);
    } else {
      const created = await this.client.taskRun.create(
        buildChangeInvestigationTaskParams({
          vendor: vendorState.vendor,
          eventId,
          changedFields: entry.decision.changedFields,
          previousReport: entry.previousReport,
          currentReport: entry.currentReport,
          ...(vendorState.baseline.stage === "completed" &&
          vendorState.baseline.run.interactionId
            ? { previousInteractionId: vendorState.baseline.run.interactionId }
            : {}),
          policyDecision: {
            threshold: entry.decision.threshold,
            previousLevel: entry.decision.previousLevel,
            currentLevel: entry.decision.currentLevel,
            requiresHumanReview: entry.decision.requiresHumanReview,
            reasons: entry.decision.reasons,
          },
          processor: this.config.followUpProcessor,
        }),
        { maxRetries: 0 },
      );
      run = {
        runId: created.run_id,
        interactionId: created.interaction_id,
        startedAt: this.now().toISOString(),
      };
      await this.store.update((current) => {
        const currentEntry = current.vendors[domain]!.events[eventId]!;
        if (currentEntry.stage !== "follow_up_queued") return;
        current.vendors[domain]!.events[eventId] = EventLedgerEntrySchema.parse({
          ...currentEntry,
          stage: "follow_up_running",
          run,
        });
      });
      summary.followUpTasksCreated += 1;
      this.report(`Created follow-up Task ${run.runId} for event ${eventId}; waiting...`);
    }

    state = await this.store.read();
    entry = state.vendors[domain]?.events[eventId];
    if (!entry || entry.stage === "event_failed") {
      throw new Error(`Follow-up event ${eventId} disappeared for ${domain}.`);
    }
    this.upsertChange(vendorState.vendor, entry, summary);

    try {
      const result = await this.tasks.wait(run.runId);
      if (result.run.run_id !== run.runId || result.run.status !== "completed") {
        throw new InvalidTaskOutputError(
          `Follow-up Task ${run.runId} returned an inconsistent completed result.`,
        );
      }
      if (result.output.type !== "json") {
        throw new InvalidTaskOutputError(
          `Follow-up Task ${run.runId} returned ${result.output.type}, expected JSON.`,
        );
      }
      let investigation: ChangeInvestigation;
      try {
        investigation = ChangeInvestigationSchema.parse(result.output.content);
      } catch (error) {
        throw new InvalidTaskOutputError(
          `Follow-up Task ${run.runId} returned an invalid investigation: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      const basis = parseTaskBasis(result.output.basis, `Follow-up Task ${run.runId}`);
      const warnings = taskWarnings(result);
      const completedAt = this.now().toISOString();
      await this.store.update((current) => {
        const currentEntry = current.vendors[domain]!.events[eventId]!;
        if (currentEntry.stage !== "follow_up_running") return;
        current.vendors[domain]!.events[eventId] = EventLedgerEntrySchema.parse({
          ...currentEntry,
          stage: "follow_up_completed",
          run: {
            ...run,
            interactionId: result.run.interaction_id || run.interactionId,
          },
          investigation,
          basis,
          warnings,
          completedAt,
        });
      });
      summary.followUpsCompleted += 1;
      for (const warning of warnings) this.report(`Follow-up ${run.runId}: ${warning}`);
      state = await this.store.read();
      entry = state.vendors[domain]!.events[eventId]!;
      if (entry.stage !== "event_failed") {
        this.upsertChange(vendorState.vendor, entry, summary);
      }
    } catch (error) {
      const failure = this.tasks.failure(error, run);
      if (!failure) throw error;
      await this.store.update((current) => {
        const currentEntry = current.vendors[domain]!.events[eventId]!;
        if (currentEntry.stage !== "follow_up_running") return;
        current.vendors[domain]!.events[eventId] = EventLedgerEntrySchema.parse({
          ...currentEntry,
          stage: "follow_up_failed",
          failedAttempts: [...currentEntry.failedAttempts, failure],
        });
      });
      const failed = (await this.store.read()).vendors[domain]!.events[eventId]!;
      if (failed.stage !== "event_failed") {
        this.upsertChange(vendorState.vendor, failed, summary);
      }
      this.addDiagnostic(summary.errors, {
        code: "follow_up_terminal_failure",
        vendor: domain,
        resourceId: run.runId,
        message: `Follow-up Task ${run.runId} failed permanently: ${failure.message}`,
      });
    }
  }

  private upsertChange(
    vendor: Vendor,
    entry: EventEvidence,
    summary: CheckSummary,
  ): void {
    const assessment = this.assessmentView(
      vendor,
      {
        kind: "monitor_event",
        monitorId: entry.monitorId,
        eventId: entry.eventId,
        eventDate: entry.eventDate,
      },
      entry.currentReport,
      entry.currentBasis,
      entry.firstSeenAt,
    );
    let followUp: FollowUpView;
    if (entry.stage === "completed_without_follow_up") {
      followUp = { status: "not_required" };
    } else if (entry.stage === "follow_up_queued") {
      followUp = { status: "pending" };
    } else if (entry.stage === "follow_up_running") {
      followUp = { status: "pending", runId: entry.run.runId };
    } else if (entry.stage === "follow_up_failed") {
      const failure = lastFailure(entry);
      followUp = {
        status: "failed",
        runId: failure.run.runId,
        message: failure.message,
        failedAt: failure.failedAt,
      };
    } else {
      followUp = {
        status: "completed",
        runId: entry.run.runId,
        investigation: entry.investigation,
        basis: entry.basis,
        warnings: entry.warnings,
      };
    }
    const value: ChangeView = {
      vendor,
      event: {
        monitorId: entry.monitorId,
        eventId: entry.eventId,
        eventDate: entry.eventDate,
        changedFields: entry.decision.changedFields,
      },
      assessment,
      decision: entry.decision,
      followUp,
    };
    const index = summary.changes.findIndex(
      (candidate) =>
        candidate.vendor.domain === vendor.domain && candidate.event.eventId === entry.eventId,
    );
    if (index === -1) summary.changes.push(value);
    else summary.changes[index] = value;
  }

  private assessmentView(
    vendor: Vendor,
    source: AssessmentView["source"],
    report: VendorReport,
    basis: FieldBasis[],
    observedAt: string,
  ): AssessmentView {
    return {
      source,
      observedAt,
      report,
      basis,
      risk: {
        ...scoreReport(report, vendor.riskFloor, basis),
        policyVersion: POLICY_VERSION,
      },
    };
  }

  private async cleanupUnlocked(options: { vendors?: string[] }): Promise<CleanupSummary> {
    const requested = options.vendors?.map(normalizeVendorDomain);
    const uniqueRequested = requested ? [...new Set(requested)] : undefined;
    const summary: CleanupSummary = {
      scope: uniqueRequested
        ? { kind: "vendors", vendors: uniqueRequested }
        : { kind: "all" },
      monitors: [],
      warnings: [],
    };
    const state = await this.store.read();
    const domains = uniqueRequested ?? Object.keys(state.vendors);

    for (const domain of domains) {
      const vendorState = state.vendors[domain];
      if (!vendorState) {
        summary.warnings.push({
          code: "unknown_vendor",
          vendor: domain,
          message: `No saved vendor state exists for ${domain}.`,
        });
        continue;
      }
      const monitor = vendorState.monitor;
      if (!monitor) {
        summary.warnings.push({
          code: "no_monitor",
          vendor: domain,
          message: `${domain} has no state-owned Monitor.`,
        });
        continue;
      }
      if (monitor.status === "cancelled") {
        summary.monitors.push({
          vendor: domain,
          monitorId: monitor.monitorId,
          status: "already_cancelled",
        });
        continue;
      }

      this.report(`Cancelling Monitor ${monitor.monitorId} for ${domain}...`);
      let resultStatus: "cancelled" | "already_cancelled" = "cancelled";
      try {
        const cancellation = await this.client.monitor.cancel(monitor.monitorId);
        if (cancellation.status !== "cancelled") {
          const confirmed = await this.client.monitor.retrieve(monitor.monitorId);
          if (confirmed.status !== "cancelled") {
            throw new Error(`Monitor ${monitor.monitorId} did not reach cancelled status.`);
          }
        }
      } catch (cancelError) {
        try {
          const remote = await this.client.monitor.retrieve(monitor.monitorId);
          if (remote.status !== "cancelled") throw cancelError;
          resultStatus = "already_cancelled";
        } catch {
          summary.monitors.push({
            vendor: domain,
            monitorId: monitor.monitorId,
            status: "failed",
            message: errorMessage(cancelError),
          });
          continue;
        }
      }

      try {
        await this.markMonitorCancelled(domain, monitor.monitorId);
        summary.monitors.push({
          vendor: domain,
          monitorId: monitor.monitorId,
          status: resultStatus,
        });
        this.report(`Cancelled Monitor ${monitor.monitorId}.`);
      } catch (error) {
        summary.monitors.push({
          vendor: domain,
          monitorId: monitor.monitorId,
          status: "failed",
          message: `Remote cancellation succeeded, but local state was not updated: ${errorMessage(error)}`,
        });
      }
    }

    return summary;
  }

  private async findAdoptableMonitor(
    vendor: Vendor,
    baselineRunId: string,
  ): Promise<SnapshotMonitor | undefined> {
    const candidates: SnapshotMonitor[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.client.monitor.list({
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
            this.config.monitorFrequency,
            this.config.monitorProcessor,
          ),
        ),
      );
      const next = page.next_cursor ?? undefined;
      if (next && cursors.has(next)) {
        throw new Error("Monitor listing returned a repeated pagination cursor.");
      }
      if (next) cursors.add(next);
      cursor = next;
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
    monitor: SnapshotMonitor,
  ): Promise<void> {
    await this.store.update((state) => {
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
    await this.store.update((state) => {
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

  private addDiagnostic(target: Diagnostic[], diagnostic: Diagnostic): void {
    target.push(diagnostic);
    this.report(diagnostic.message);
  }
}
