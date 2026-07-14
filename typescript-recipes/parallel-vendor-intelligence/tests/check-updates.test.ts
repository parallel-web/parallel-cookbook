import { afterEach, describe, expect, it } from "vitest";

import type { MonitorErrorEvent, MonitorSnapshotEvent } from "../src/parallel-port.js";
import { DEFAULT_CONFIG } from "../src/vendor-config.js";
import { VendorIntelligence } from "../src/vendor-intelligence.js";
import {
  basis,
  investigation,
  investigationResult,
  snapshotEvent,
  snapshotMonitor,
  taskRun,
  vendorReport,
} from "./fixtures.js";
import {
  cleanupTestDirectories,
  fixedNow,
  runtime,
  seedCompletedVendor,
  vendor,
} from "./runtime.js";

afterEach(cleanupTestDirectories);

describe("snapshot reconstruction and update checks", () => {
  it("treats an empty event page as a successful check", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "monitor-1" });
    await expect(test.service.checkForUpdates()).resolves.toMatchObject({
      monitorsChecked: 1,
      newEvents: 0,
      changes: [],
      errors: [],
    });
  });

  it("returns a rich assessment for a non-material change without creating a Task", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const event = snapshotEvent({
      eventId: "low-change",
      previous,
      changed: {
        financial_health: {
          ...previous.financial_health,
          summary: "A small wording change.",
        },
      },
      changedBasis: [basis("financial_health")],
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValue({ events: [event] });

    const summary = await test.service.checkForUpdates();
    expect(summary).toMatchObject({
      newEvents: 1,
      followUpTasksCreated: 0,
      changes: [
        {
          vendor,
          event: { eventId: "low-change", changedFields: ["financial_health"] },
          assessment: {
            report: { financial_health: { summary: "A small wording change." } },
            risk: { level: "LOW", guidance: "continue_monitoring" },
          },
          followUp: { status: "not_required" },
        },
      ],
    });
    expect(test.taskCreate).not.toHaveBeenCalled();
    expect(
      (await test.store.read()).vendors[vendor.domain]?.events["low-change"]?.stage,
    ).toBe("completed_without_follow_up");
  });

  it("persists and returns the completed focused investigation", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const event = snapshotEvent({
      eventId: "high-change",
      previous,
      changed: {
        cybersecurity: vendorReport({ cybersecurity: "HIGH" }).cybersecurity,
      },
      changedBasis: [basis("cybersecurity")],
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValue({ events: [event] });
    test.taskCreate.mockResolvedValue(taskRun("follow-1"));
    test.taskResult.mockResolvedValue(investigationResult("follow-1"));

    const summary = await test.service.checkForUpdates();
    expect(summary).toMatchObject({
      newEvents: 1,
      followUpDecisions: 1,
      followUpTasksCreated: 1,
      followUpsCompleted: 1,
      humanReviewsRequired: 1,
      changes: [
        {
          assessment: { risk: { level: "HIGH", guidance: "urgent_human_review" } },
          decision: { runFollowUp: true, policyVersion: 1 },
          followUp: {
            status: "completed",
            runId: "follow-1",
            investigation,
            basis: [basis("what_changed")],
          },
        },
      ],
    });
    expect(test.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        processor: "pro",
        previous_interaction_id: "interaction-run-example.com",
        input: expect.objectContaining({ monitor_event_id: "high-change" }),
      }),
      { maxRetries: 0 },
    );
    expect(
      (await test.store.read()).vendors[vendor.domain]?.events["high-change"]?.stage,
    ).toBe("follow_up_completed");
  });

  it("deduplicates persisted events in a fresh service instance", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const event = snapshotEvent({
      eventId: "once",
      previous,
      changed: {
        legal_regulatory: { ...previous.legal_regulatory, summary: "updated" },
      },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValue({ events: [event] });
    expect((await test.service.checkForUpdates()).newEvents).toBe(1);

    const second = new VendorIntelligence({
      client: test.client,
      store: test.store,
      config: DEFAULT_CONFIG,
      now: () => fixedNow,
      sleep: async () => {},
      reporter: () => {},
    });
    expect((await second.checkForUpdates()).newEvents).toBe(0);
    expect(test.taskCreate).not.toHaveBeenCalled();
  });

  it("paginates newest-first history and keeps the newest durable assessment", async () => {
    const test = await runtime();
    const baseline = vendorReport();
    const middle = {
      ...baseline,
      financial_health: { ...baseline.financial_health, summary: "middle" },
    };
    const oldest = snapshotEvent({
      eventId: "oldest",
      previous: baseline,
      changed: { financial_health: middle.financial_health },
    });
    const newest = snapshotEvent({
      eventId: "newest",
      previous: middle,
      changed: {
        legal_regulatory: { ...middle.legal_regulatory, summary: "newest" },
      },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: baseline });
    test.monitorEvents
      .mockResolvedValueOnce({ events: [newest], next_cursor: "older" })
      .mockResolvedValueOnce({ events: [oldest] });

    const summary = await test.service.checkForUpdates();
    expect(summary.changes.map(({ event }) => event.eventId)).toEqual(["oldest", "newest"]);
    expect((await test.store.read()).vendors[vendor.domain]?.latestEventId).toBe("newest");
  });

  it("resumes a saved follow-up after a transient result failure", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const high = snapshotEvent({
      eventId: "resumable",
      previous,
      changed: { cybersecurity: vendorReport({ cybersecurity: "HIGH" }).cybersecurity },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValueOnce({ events: [high] }).mockResolvedValue({ events: [] });
    test.taskCreate.mockResolvedValue(taskRun("saved-follow-up"));
    test.taskResult
      .mockRejectedValueOnce({ status: 503, message: "temporary" })
      .mockResolvedValueOnce(investigationResult("saved-follow-up"));

    const interrupted = await test.service.checkForUpdates();
    expect(interrupted.errors).toHaveLength(1);
    expect(interrupted.changes).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ eventId: "resumable" }),
        followUp: { status: "pending", runId: "saved-follow-up" },
      }),
    ]);
    expect(
      (await test.store.read()).vendors[vendor.domain]?.events.resumable?.stage,
    ).toBe("follow_up_running");
    expect((await test.service.checkForUpdates()).followUpsCompleted).toBe(1);
    expect(test.taskCreate).toHaveBeenCalledTimes(1);
  });

  it("persists terminal follow-up failure, continues newer events, and retries explicitly", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const high = snapshotEvent({
      eventId: "failed-high",
      previous,
      changed: { cybersecurity: vendorReport({ cybersecurity: "HIGH" }).cybersecurity },
    });
    const newer = snapshotEvent({
      eventId: "newer-low",
      previous: {
        ...previous,
        cybersecurity: vendorReport({ cybersecurity: "HIGH" }).cybersecurity,
      },
      changed: {
        legal_regulatory: { ...previous.legal_regulatory, summary: "newer" },
      },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValueOnce({ events: [newer, high] }).mockResolvedValue({
      events: [],
    });
    test.taskCreate
      .mockResolvedValueOnce(taskRun("failed-follow-up"))
      .mockResolvedValueOnce(taskRun("replacement-follow-up"));
    test.taskResult
      .mockRejectedValueOnce({ status: 422, message: "failed" })
      .mockResolvedValueOnce(investigationResult("replacement-follow-up"));
    test.taskRetrieve.mockResolvedValueOnce({
      ...taskRun("failed-follow-up"),
      status: "failed",
      error: { message: "investigation failed" },
    });

    const first = await test.service.checkForUpdates();
    expect(first.changes.map(({ event }) => event.eventId)).toEqual([
      "failed-high",
      "newer-low",
    ]);
    const state = await test.store.read();
    expect(state.vendors[vendor.domain]?.events["failed-high"]?.stage).toBe(
      "follow_up_failed",
    );
    expect(state.vendors[vendor.domain]?.events["newer-low"]?.stage).toBe(
      "completed_without_follow_up",
    );

    await test.service.checkForUpdates();
    expect(test.taskCreate).toHaveBeenCalledTimes(1);
    const retried = await test.service.checkForUpdates({ retryFailed: true });
    expect(retried.followUpsCompleted).toBe(1);
    expect(retried.changes[0]?.followUp).toMatchObject({
      status: "completed",
      runId: "replacement-follow-up",
    });
    expect(test.taskCreate).toHaveBeenCalledTimes(2);
  });

  it("persists an invalid completed follow-up basis as a terminal failure", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const event = snapshotEvent({
      eventId: "invalid-follow-up-basis",
      previous,
      changed: { cybersecurity: vendorReport({ cybersecurity: "HIGH" }).cybersecurity },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValue({ events: [event] });
    test.taskCreate.mockResolvedValue(taskRun("follow-invalid-basis"));
    test.taskResult.mockResolvedValue({
      ...investigationResult("follow-invalid-basis"),
      output: {
        type: "json",
        content: investigation,
        basis: { invalid: true },
      },
    });

    const summary = await test.service.checkForUpdates();
    expect(summary.errors).toContainEqual(
      expect.objectContaining({ code: "follow_up_terminal_failure" }),
    );
    const saved = (await test.store.read()).vendors[vendor.domain]?.events[
      "invalid-follow-up-basis"
    ];
    expect(saved?.stage).toBe("follow_up_failed");
    if (!saved || saved.stage !== "follow_up_failed") throw new Error("missing failure");
    expect(saved.failedAttempts[0]).toMatchObject({ kind: "invalid_output" });
  });

  it("quarantines an invalid event, processes newer events, and can retry saved raw data", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const poison: MonitorSnapshotEvent = {
      event_id: "poison",
      event_group_id: "group-poison",
      event_date: "2026-07-08",
      event_type: "snapshot",
      previous_output: { type: "json", content: previous, basis: [] },
      changed_output: {
        type: "json",
        content: { unknown_field: { value: true } },
        basis: [],
      },
    };
    const newer = snapshotEvent({
      eventId: "newer-valid",
      previous,
      changed: {
        financial_health: { ...previous.financial_health, summary: "newer" },
      },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents
      .mockResolvedValueOnce({ events: [newer] })
      .mockResolvedValueOnce({ events: [newer, poison] })
      .mockResolvedValue({ events: [] });

    await test.service.checkForUpdates();
    const first = await test.service.checkForUpdates();
    expect(first.errors).toContainEqual(
      expect.objectContaining({ code: "invalid_snapshot_event", resourceId: "poison" }),
    );
    let state = await test.store.read();
    expect(state.vendors[vendor.domain]?.events.poison?.stage).toBe("event_failed");
    expect(state.vendors[vendor.domain]?.latestEventId).toBe("newer-valid");

    await test.store.update((current) => {
      const failed = current.vendors[vendor.domain]?.events.poison;
      if (!failed || failed.stage !== "event_failed") throw new Error("missing poison");
      if (failed.rawEvent.changedOutput.type !== "json") throw new Error("expected JSON");
      failed.rawEvent.changedOutput.content = {
        legal_regulatory: { ...previous.legal_regulatory, summary: "recovered older event" },
      };
    });
    const retriedAt = new Date("2026-07-10T15:30:00.000Z");
    const retryService = new VendorIntelligence({
      client: test.client,
      store: test.store,
      config: DEFAULT_CONFIG,
      now: () => retriedAt,
      sleep: async () => {},
      reporter: () => {},
    });
    const retried = await retryService.checkForUpdates({ retryFailed: true });
    expect(retried.errors).toEqual([]);
    state = await test.store.read();
    const recovered = state.vendors[vendor.domain]?.events.poison;
    expect(recovered?.stage).toBe("completed_without_follow_up");
    if (!recovered || recovered.stage === "event_failed") throw new Error("missing event");
    expect(recovered.firstSeenAt).toBe(fixedNow.toISOString());
    expect(recovered.decision.evaluatedAt).toBe(retriedAt.toISOString());
    expect(state.vendors[vendor.domain]?.latestEventId).toBe("newer-valid");
  });

  it("quarantines opaque malformed event payloads without blocking newer events", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const malformedContent: MonitorSnapshotEvent = {
      event_id: "scalar-content",
      event_group_id: "group-scalar-content",
      event_date: "2026-07-07",
      previous_output: { type: "json", content: previous, basis: [] },
      changed_output: { type: "json", content: 42, basis: [] },
    };
    const malformedBasis: MonitorSnapshotEvent = {
      event_id: "malformed-basis",
      event_group_id: "group-malformed-basis",
      event_date: "2026-07-08",
      previous_output: { type: "json", content: previous, basis: [] },
      changed_output: {
        type: "json",
        content: {
          financial_health: { ...previous.financial_health, summary: "changed" },
        },
        basis: "not-an-array",
      },
    };
    const newest = snapshotEvent({
      eventId: "valid-after-malformed",
      previous,
      changed: {
        legal_regulatory: { ...previous.legal_regulatory, summary: "newest" },
      },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValue({
      events: [newest, malformedBasis, malformedContent],
    });

    const summary = await test.service.checkForUpdates();
    expect(summary.newEvents).toBe(3);
    expect(summary.errors.filter(({ code }) => code === "invalid_snapshot_event")).toHaveLength(
      2,
    );
    const state = await test.store.read();
    expect(state.vendors[vendor.domain]?.events["scalar-content"]?.stage).toBe(
      "event_failed",
    );
    expect(state.vendors[vendor.domain]?.events["malformed-basis"]?.stage).toBe(
      "event_failed",
    );
    expect(state.vendors[vendor.domain]?.latestEventId).toBe("valid-after-malformed");
  });

  it("blocks same-pass history after a retried poison event starts a transient follow-up", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const poison: MonitorSnapshotEvent = {
      event_id: "retry-to-follow-up",
      event_group_id: "group-retry-to-follow-up",
      event_date: "2026-07-09",
      previous_output: { type: "json", content: previous, basis: [] },
      changed_output: { type: "json", content: { unknown_field: true }, basis: [] },
    };
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValueOnce({ events: [poison] });
    await test.service.checkForUpdates();
    await test.store.update((state) => {
      const failed = state.vendors[vendor.domain]?.events["retry-to-follow-up"];
      if (!failed || failed.stage !== "event_failed") throw new Error("missing poison");
      failed.rawEvent.changedOutput.content = {
        cybersecurity: vendorReport({ cybersecurity: "HIGH" }).cybersecurity,
      };
    });
    test.taskCreate.mockResolvedValue(taskRun("transient-follow-up"));
    test.taskResult.mockRejectedValue({ status: 503, message: "temporary" });
    test.monitorEvents.mockReset();
    test.monitorEvents.mockResolvedValue({
      events: [
        snapshotEvent({
          eventId: "newer-event",
          previous,
          changed: {
            financial_health: { ...previous.financial_health, summary: "newer" },
          },
        }),
      ],
    });

    const summary = await test.service.checkForUpdates({ retryFailed: true });
    expect(summary.errors).toContainEqual(
      expect.objectContaining({ code: "event_resume_failed" }),
    );
    expect(summary.changes).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({ eventId: "retry-to-follow-up" }),
        followUp: { status: "pending", runId: "transient-follow-up" },
      }),
    );
    expect(test.monitorEvents).not.toHaveBeenCalled();
    expect(test.taskCreate).toHaveBeenCalledOnce();
  });

  it("reports retained-history gaps", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "monitor-1" });
    await test.store.update((state) => {
      const monitor = state.vendors[vendor.domain]?.monitor;
      if (monitor?.status === "active") monitor.newestObservedEventId = "expired";
    });
    const summary = await test.service.checkForUpdates();
    expect(summary.warnings).toContainEqual(
      expect.objectContaining({ code: "monitor_history_gap" }),
    );
  });

  it("recomputes current display risk without rewriting the historical decision", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const event = snapshotEvent({
      eventId: "historical-policy",
      previous,
      changed: {
        financial_health: { ...previous.financial_health, summary: "minor change" },
      },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValue({ events: [event] });
    await test.service.checkForUpdates();

    test.monitorEvents.mockResolvedValue({ events: [] });
    test.monitorRetrieve.mockResolvedValue(
      snapshotMonitor("monitor-1", "run-example.com"),
    );
    const bootstrap = await test.service.bootstrap([
      { ...vendor, riskFloor: "HIGH" },
    ]);
    expect(bootstrap.results[0]?.assessment.risk.level).toBe("HIGH");
    const saved = (await test.store.read()).vendors[vendor.domain]?.events[
      "historical-policy"
    ];
    expect(saved?.stage).toBe("completed_without_follow_up");
    if (!saved || saved.stage === "event_failed") throw new Error("missing event");
    expect(saved.decision.runFollowUp).toBe(false);
    expect(saved.decision.riskFloor).toBeUndefined();
    expect(saved.decision.policyVersion).toBe(1);
  });

  it("retains a newest-first checkpoint without re-reporting older execution errors", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "monitor-1" });
    const failures: MonitorErrorEvent[] = Array.from({ length: 101 }, (_, index) => ({
      event_type: "error",
      timestamp: `2026-07-09T11:${String(index).padStart(2, "0")}:00.000Z`,
      error_message: `error-${index}`,
    }));
    test.monitorEvents.mockResolvedValue({ events: failures });
    expect((await test.service.checkForUpdates()).errors).toHaveLength(101);
    const saved = await test.store.read();
    const monitor = saved.vendors[vendor.domain]?.monitor;
    expect(monitor?.status).toBe("active");
    if (monitor?.status !== "active") throw new Error("missing active monitor");
    expect(monitor.reportedExecutionErrors).toHaveLength(100);
    expect(monitor.reportedExecutionErrors?.[0]).toContain("error-0");
    const second = await test.service.checkForUpdates();
    expect(second.errors).toEqual([]);
    expect((await test.service.checkForUpdates()).errors).toEqual([]);
  });

  it("deduplicates a pagination-boundary error without hiding later new errors", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "monitor-1" });
    const first: MonitorErrorEvent = {
      event_type: "error",
      timestamp: "2026-07-09T12:00:00.000Z",
      error_message: "newest failure",
    };
    const second: MonitorErrorEvent = {
      event_type: "error",
      timestamp: "2026-07-09T11:00:00.000Z",
      error_message: "older new failure",
    };
    test.monitorEvents
      .mockResolvedValueOnce({ events: [first], next_cursor: "older" })
      .mockResolvedValueOnce({ events: [first, second] });

    const summary = await test.service.checkForUpdates();
    expect(summary.errors.map(({ message }) => message)).toEqual([
      expect.stringContaining("newest failure"),
      expect.stringContaining("older new failure"),
    ]);
  });

  it("reconstructs sequential empty-previous patches oldest to newest", async () => {
    const test = await runtime();
    const baseline = vendorReport();
    const firstFinancial = {
      ...baseline.financial_health,
      summary: "First observed financial change.",
    };
    const secondLegal = {
      ...baseline.legal_regulatory,
      summary: "Later legal change.",
    };
    const first: MonitorSnapshotEvent = {
      event_id: "partial-first",
      event_group_id: "group-partial-first",
      event_date: "2026-07-13",
      previous_output: { type: "json", content: {}, basis: [] },
      changed_output: {
        type: "json",
        content: { financial_health: firstFinancial },
        basis: [basis("financial_health", "https://first.test/financial")],
      },
    };
    const second: MonitorSnapshotEvent = {
      event_id: "partial-second",
      event_group_id: "group-partial-second",
      event_date: "2026-07-14",
      previous_output: { type: "json", content: {}, basis: [] },
      changed_output: {
        type: "json",
        content: { legal_regulatory: secondLegal },
        basis: [basis("legal_regulatory", "https://second.test/legal")],
      },
    };
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: baseline });
    await test.store.update((state) => {
      const completed = state.vendors[vendor.domain]?.baseline;
      if (completed?.stage !== "completed") throw new Error("missing baseline");
      completed.evidence.basis = [
        basis("cybersecurity", "https://baseline.test/security"),
        basis("financial_health", "https://baseline.test/financial"),
      ];
    });
    test.monitorEvents.mockResolvedValue({ events: [second, first] });

    const summary = await test.service.checkForUpdates();
    expect(summary.changes.map(({ event }) => event.eventId)).toEqual([
      "partial-first",
      "partial-second",
    ]);
    const saved = (await test.store.read()).vendors[vendor.domain]?.events["partial-second"];
    expect(saved?.stage).toBe("completed_without_follow_up");
    if (!saved || saved.stage === "event_failed") throw new Error("missing second event");
    expect(saved.previousReport.financial_health).toEqual(firstFinancial);
    expect(saved.currentReport.legal_regulatory).toEqual(secondLegal);
    expect(saved.currentBasis).toEqual([
      basis("cybersecurity", "https://baseline.test/security"),
      basis("financial_health", "https://first.test/financial"),
      basis("legal_regulatory", "https://second.test/legal"),
    ]);
  });

  it("blocks an empty-previous patch after an invalid predecessor", async () => {
    const test = await runtime();
    const baseline = vendorReport();
    const invalid: MonitorSnapshotEvent = {
      event_id: "invalid-predecessor",
      event_group_id: "group-invalid-predecessor",
      event_date: "2026-07-13",
      previous_output: { type: "json", content: {}, basis: [] },
      changed_output: { type: "json", content: { unknown_field: true }, basis: [] },
    };
    const dependent: MonitorSnapshotEvent = {
      event_id: "dependent-partial",
      event_group_id: "group-dependent-partial",
      event_date: "2026-07-14",
      previous_output: { type: "json", content: {}, basis: [] },
      changed_output: {
        type: "json",
        content: {
          financial_health: {
            ...baseline.financial_health,
            summary: "Must not merge into stale baseline state.",
          },
        },
        basis: [],
      },
    };
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: baseline });
    test.monitorEvents.mockResolvedValue({ events: [dependent, invalid] });

    const summary = await test.service.checkForUpdates();
    expect(summary.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceId: "invalid-predecessor" }),
        expect.objectContaining({
          resourceId: "dependent-partial",
          message: expect.stringContaining("no complete predecessor"),
        }),
      ]),
    );
    const state = await test.store.read();
    expect(state.vendors[vendor.domain]?.events["invalid-predecessor"]?.stage).toBe(
      "event_failed",
    );
    expect(state.vendors[vendor.domain]?.events["dependent-partial"]?.stage).toBe(
      "event_failed",
    );
    expect(state.vendors[vendor.domain]?.latestEventId).toBeUndefined();
  });

  it("resumes after an invalid event when the API supplies a complete predecessor", async () => {
    const test = await runtime();
    const baseline = vendorReport();
    const invalid: MonitorSnapshotEvent = {
      event_id: "invalid-before-rebase",
      event_group_id: "group-invalid-before-rebase",
      event_date: "2026-07-13",
      previous_output: { type: "json", content: {}, basis: [] },
      changed_output: { type: "json", content: { unknown_field: true }, basis: [] },
    };
    const completeRebase = snapshotEvent({
      eventId: "complete-rebase",
      previous: vendorReport({ operational_resilience: "MEDIUM" }),
      changed: {
        legal_regulatory: {
          ...baseline.legal_regulatory,
          summary: "Complete predecessor restored the chain.",
        },
      },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: baseline });
    test.monitorEvents.mockResolvedValue({ events: [completeRebase, invalid] });

    const summary = await test.service.checkForUpdates();
    expect(summary.changes.map(({ event }) => event.eventId)).toEqual(["complete-rebase"]);
    const state = await test.store.read();
    expect(state.vendors[vendor.domain]?.events["invalid-before-rebase"]?.stage).toBe(
      "event_failed",
    );
    expect(state.vendors[vendor.domain]?.events["complete-rebase"]?.stage).toBe(
      "completed_without_follow_up",
    );
    expect(state.vendors[vendor.domain]?.latestEventId).toBe("complete-rebase");
  });

  it("seeds a retained-history gap from the latest durable checkpoint", async () => {
    const test = await runtime();
    const baseline = vendorReport();
    const first: MonitorSnapshotEvent = {
      event_id: "checkpoint",
      event_group_id: "group-checkpoint",
      event_date: "2026-07-13",
      previous_output: { type: "json", content: {}, basis: [] },
      changed_output: {
        type: "json",
        content: {
          financial_health: {
            ...baseline.financial_health,
            summary: "Durable checkpoint value.",
          },
        },
        basis: [],
      },
    };
    const afterGap: MonitorSnapshotEvent = {
      event_id: "after-gap",
      event_group_id: "group-after-gap",
      event_date: "2026-07-14",
      previous_output: { type: "json", content: {}, basis: [] },
      changed_output: {
        type: "json",
        content: {
          legal_regulatory: {
            ...baseline.legal_regulatory,
            summary: "Retained event after the checkpoint.",
          },
        },
        basis: [],
      },
    };
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: baseline });
    test.monitorEvents.mockResolvedValueOnce({ events: [first] });
    await test.service.checkForUpdates();
    test.monitorEvents.mockResolvedValue({ events: [afterGap] });

    const summary = await test.service.checkForUpdates();
    expect(summary.warnings).toContainEqual(
      expect.objectContaining({ code: "monitor_history_gap" }),
    );
    const saved = (await test.store.read()).vendors[vendor.domain]?.events["after-gap"];
    expect(saved?.stage).toBe("completed_without_follow_up");
    if (!saved || saved.stage === "event_failed") throw new Error("missing gap event");
    expect(saved.previousReport.financial_health.summary).toBe("Durable checkpoint value.");
  });

  it("retries an empty-previous failed event from its persisted prior snapshot", async () => {
    const test = await runtime();
    const baseline = vendorReport();
    const event: MonitorSnapshotEvent = {
      event_id: "retry-with-snapshot",
      event_group_id: "group-retry-with-snapshot",
      event_date: "2026-07-14",
      previous_output: { type: "json", content: {}, basis: [] },
      changed_output: { type: "json", content: { unknown_field: true }, basis: [] },
    };
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: baseline });
    test.monitorEvents.mockResolvedValueOnce({ events: [event] }).mockResolvedValue({ events: [] });
    await test.service.checkForUpdates();
    expect((await test.service.checkForUpdates()).errors).toContainEqual(
      expect.objectContaining({
        code: "event_requires_retry",
        message: expect.stringContaining("unknown_field"),
      }),
    );
    await test.store.update((state) => {
      const failed = state.vendors[vendor.domain]?.events["retry-with-snapshot"];
      if (!failed || failed.stage !== "event_failed") throw new Error("missing failure");
      expect(failed.priorSnapshot?.report).toEqual(baseline);
      failed.rawEvent.changedOutput.content = {
        financial_health: {
          ...baseline.financial_health,
          summary: "Recovered deterministically.",
        },
      };
    });

    const summary = await test.service.checkForUpdates({ retryFailed: true });
    expect(summary.errors).toEqual([]);
    const recovered = (await test.store.read()).vendors[vendor.domain]?.events[
      "retry-with-snapshot"
    ];
    expect(recovered?.stage).toBe("completed_without_follow_up");
    expect(test.taskCreate).not.toHaveBeenCalled();
  });

  it("recovers a safe legacy first event but rejects ambiguous legacy recovery", async () => {
    const safe = await runtime();
    const baseline = vendorReport();
    const legacy: MonitorSnapshotEvent = {
      event_id: "legacy-first",
      event_group_id: "group-legacy-first",
      event_date: "2026-07-14",
      previous_output: { type: "json", content: {}, basis: [] },
      changed_output: { type: "json", content: { unknown_field: true }, basis: [] },
    };
    await seedCompletedVendor(safe.store, { monitorId: "monitor-1", report: baseline });
    safe.monitorEvents.mockResolvedValueOnce({ events: [legacy] }).mockResolvedValue({ events: [] });
    await safe.service.checkForUpdates();
    await safe.store.update((state) => {
      const failed = state.vendors[vendor.domain]?.events["legacy-first"];
      if (!failed || failed.stage !== "event_failed") throw new Error("missing legacy event");
      delete failed.priorSnapshot;
      failed.rawEvent.changedOutput.content = {
        financial_health: baseline.financial_health,
      };
    });
    expect((await safe.service.checkForUpdates({ retryFailed: true })).errors).toEqual([]);

    const ambiguous = await runtime();
    const valid = snapshotEvent({
      eventId: "prior-valid",
      previous: baseline,
      changed: { financial_health: baseline.financial_health },
    });
    const ambiguousFailure: MonitorSnapshotEvent = {
      ...legacy,
      event_id: "legacy-ambiguous",
      event_group_id: "group-legacy-ambiguous",
    };
    await seedCompletedVendor(ambiguous.store, {
      monitorId: "monitor-1",
      report: baseline,
    });
    ambiguous.monitorEvents
      .mockResolvedValueOnce({ events: [ambiguousFailure, valid] })
      .mockResolvedValue({ events: [] });
    await ambiguous.service.checkForUpdates();
    await ambiguous.store.update((state) => {
      const failed = state.vendors[vendor.domain]?.events["legacy-ambiguous"];
      if (!failed || failed.stage !== "event_failed") throw new Error("missing ambiguity");
      delete failed.priorSnapshot;
      failed.rawEvent.changedOutput.content = {
        legal_regulatory: baseline.legal_regulatory,
      };
    });

    const rejected = await ambiguous.service.checkForUpdates({ retryFailed: true });
    expect(rejected.errors).toContainEqual(
      expect.objectContaining({
        resourceId: "legacy-ambiguous",
        message: expect.stringContaining("no unambiguous predecessor"),
      }),
    );
    expect(
      (await ambiguous.store.read()).vendors[vendor.domain]?.events["legacy-ambiguous"]
        ?.stage,
    ).toBe("event_failed");
  });

  it("does not duplicate a paid follow-up Task when history is replayed", async () => {
    const test = await runtime();
    const baseline = vendorReport();
    const high: MonitorSnapshotEvent = {
      event_id: "one-paid-follow-up",
      event_group_id: "group-one-paid-follow-up",
      event_date: "2026-07-14",
      previous_output: { type: "json", content: {}, basis: [] },
      changed_output: {
        type: "json",
        content: {
          cybersecurity: vendorReport({ cybersecurity: "HIGH" }).cybersecurity,
        },
        basis: [],
      },
    };
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: baseline });
    test.monitorEvents.mockResolvedValue({ events: [high] });
    test.taskCreate.mockResolvedValue(taskRun("only-follow-up"));
    test.taskResult.mockResolvedValue(investigationResult("only-follow-up"));

    expect((await test.service.checkForUpdates()).followUpTasksCreated).toBe(1);
    expect((await test.service.checkForUpdates()).newEvents).toBe(0);
    expect(test.taskCreate).toHaveBeenCalledTimes(1);
  });
});
