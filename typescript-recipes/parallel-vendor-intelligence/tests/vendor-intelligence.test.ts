import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParallelPort } from "../src/parallel-port.js";
import { decideFollowUp, scoreReport } from "../src/risk-policy.js";
import type { Vendor, VendorReport } from "../src/schema.js";
import { FileStateStore } from "../src/state.js";
import {
  DEFAULT_CONFIG,
  reconstructSnapshotEvent,
  VendorIntelligence,
  type VendorIntelligenceConfig,
} from "../src/vendor-intelligence.js";
import {
  basis,
  investigationResult,
  reportResult,
  snapshotEvent,
  snapshotMonitor,
  taskRun,
  vendorReport,
} from "./fixtures.js";

const directories: string[] = [];
const vendor: Vendor = { name: "Example", domain: "example.com" };
const fixedNow = new Date("2026-07-09T12:00:00.000Z");

function fakeClient() {
  const taskCreate = vi.fn(async () => taskRun());
  const taskResult = vi.fn(async () => reportResult(vendorReport()));
  const monitorCreate = vi.fn(async () => snapshotMonitor());
  const monitorRetrieve = vi.fn(async () => snapshotMonitor());
  const monitorList = vi.fn(async () => ({ monitors: [] }));
  const monitorEvents = vi.fn(async () => ({ events: [] }));
  const monitorCancel = vi.fn(async (id: string) => snapshotMonitor(id, "run-1", "cancelled"));
  const client = {
    taskRun: { create: taskCreate, result: taskResult },
    monitor: {
      create: monitorCreate,
      retrieve: monitorRetrieve,
      list: monitorList,
      events: monitorEvents,
      cancel: monitorCancel,
    },
  } as unknown as ParallelPort;
  return {
    client,
    taskCreate,
    taskResult,
    monitorCreate,
    monitorRetrieve,
    monitorList,
    monitorEvents,
    monitorCancel,
  };
}

async function runtime(
  fake = fakeClient(),
  config: Partial<VendorIntelligenceConfig> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "vendor-intelligence-runtime-"));
  directories.push(directory);
  const store = new FileStateStore(directory);
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new VendorIntelligence({
    client: fake.client,
    store,
    config: { ...DEFAULT_CONFIG, ...config },
    now: () => fixedNow,
    sleep: async () => {},
    logger,
  });
  return { ...fake, directory, store, service, logger };
}

async function seedCompletedVendor(
  store: FileStateStore,
  options: {
    inputVendor?: Vendor;
    report?: VendorReport;
    monitorId?: string;
    monitorStatus?: "active" | "cancelled";
  } = {},
) {
  const inputVendor = options.inputVendor ?? vendor;
  const report = options.report ?? vendorReport();
  const assessment = scoreReport(report, inputVendor.riskFloor);
  await store.update((state) => {
    state.vendors[inputVendor.domain] = {
      vendor: inputVendor,
      baseline: {
        stage: "completed",
        runId: `run-${inputVendor.domain}`,
        report,
        basis: [],
        assessment,
        observedAt: fixedNow.toISOString(),
      },
      latest: {
        report,
        basis: [],
        assessment,
        observedAt: fixedNow.toISOString(),
      },
      monitor: options.monitorId
        ? options.monitorStatus === "cancelled"
          ? {
              status: "cancelled",
              monitorId: options.monitorId,
              baselineRunId: `run-${inputVendor.domain}`,
              frequency: "1d",
              processor: "lite",
              createdAt: fixedNow.toISOString(),
              cancelledAt: fixedNow.toISOString(),
            }
          : {
              status: "active",
              monitorId: options.monitorId,
              baselineRunId: `run-${inputVendor.domain}`,
              frequency: "1d",
              processor: "lite",
              createdAt: fixedNow.toISOString(),
            }
        : undefined,
      events: {},
    };
  });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("bootstrap", () => {
  it("persists the run before completing a baseline, creates one snapshot Monitor, and reuses both", async () => {
    const test = await runtime();
    const first = await test.service.bootstrap([vendor]);

    expect(first).toMatchObject({ baselinesCreated: 1, monitorsCreated: 1 });
    expect(test.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        processor: "core",
        input: expect.objectContaining({ vendor_domain: "example.com" }),
      }),
    );
    expect(test.taskResult).toHaveBeenCalledWith(
      "run-1",
      { timeout: 25 },
      { maxRetries: 0 },
    );
    expect(test.monitorCreate).toHaveBeenCalledWith({
      type: "snapshot",
      frequency: "1d",
      processor: "lite",
      settings: { task_run_id: "run-1" },
      metadata: { recipe: "vendor-intel", vendor: "example.com", spec: "1" },
    });
    expect((await test.store.read()).vendors["example.com"]?.baseline.stage).toBe(
      "completed",
    );

    const second = await test.service.bootstrap([vendor]);
    expect(second).toMatchObject({ baselinesReused: 1, monitorsReused: 1 });
    expect(test.taskCreate).toHaveBeenCalledTimes(1);
    expect(test.monitorCreate).toHaveBeenCalledTimes(1);
  });

  it("resumes a saved running Task instead of creating another", async () => {
    const test = await runtime();
    await test.store.update((state) => {
      state.vendors[vendor.domain] = {
        vendor,
        baseline: {
          stage: "running",
          runId: "saved-run",
          startedAt: fixedNow.toISOString(),
        },
        events: {},
      };
    });
    test.taskResult.mockResolvedValue(reportResult(vendorReport(), "saved-run"));

    await test.service.bootstrap([vendor]);
    expect(test.taskCreate).not.toHaveBeenCalled();
    expect(test.taskResult).toHaveBeenCalledWith(
      "saved-run",
      { timeout: 25 },
      { maxRetries: 0 },
    );
  });

  it("owns 408 result polling but fails fast for terminal Task errors", async () => {
    const retrying = await runtime();
    retrying.taskResult
      .mockRejectedValueOnce({ status: 408 })
      .mockResolvedValueOnce(reportResult(vendorReport()));
    await retrying.service.bootstrap([vendor]);
    expect(retrying.taskResult).toHaveBeenCalledTimes(2);

    const terminal = await runtime();
    terminal.taskResult.mockRejectedValue({ status: 401 });
    await expect(terminal.service.bootstrap([vendor])).rejects.toEqual({ status: 401 });
    expect(terminal.taskResult).toHaveBeenCalledTimes(1);
  });

  it("paginates and adopts exactly one active Monitor matching metadata and baseline", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store);
    const unrelated = snapshotMonitor("unrelated", "other-run");
    const adopted = snapshotMonitor("adopted", "run-example.com");
    test.monitorList
      .mockResolvedValueOnce({ monitors: [unrelated], next_cursor: "next" })
      .mockResolvedValueOnce({ monitors: [adopted] });

    const summary = await test.service.bootstrap([vendor]);
    expect(summary.monitorsAdopted).toBe(1);
    expect(test.monitorCreate).not.toHaveBeenCalled();
    expect((await test.store.read()).vendors[vendor.domain]?.monitor?.monitorId).toBe(
      "adopted",
    );
    expect(test.monitorList.mock.calls[0]?.[0]).toMatchObject({
      status: ["active"],
      type: ["snapshot"],
    });
  });

  it("refuses to guess when more than one orphan Monitor matches", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store);
    test.monitorList.mockResolvedValue({
      monitors: [
        snapshotMonitor("first", "run-example.com"),
        snapshotMonitor("second", "run-example.com"),
      ],
    });
    await expect(test.service.bootstrap([vendor])).rejects.toThrow("first, second");
    expect(test.monitorCreate).not.toHaveBeenCalled();
  });

  it("reuses the completed baseline and creates a new Monitor after cleanup", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, {
      monitorId: "cancelled-monitor",
      monitorStatus: "cancelled",
    });
    const summary = await test.service.bootstrap([vendor]);
    expect(summary).toMatchObject({ baselinesReused: 1, monitorsCreated: 1 });
    expect(test.taskCreate).not.toHaveBeenCalled();
  });

  it("recreates a locally active Monitor that is remotely cancelled", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "stale-monitor" });
    test.monitorRetrieve.mockResolvedValue(
      snapshotMonitor("stale-monitor", "run-example.com", "cancelled"),
    );
    test.monitorList.mockResolvedValue({ monitors: [] });

    const summary = await test.service.bootstrap([vendor]);
    expect(summary.monitorsCreated).toBe(1);
    expect(test.monitorCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects changing baseline identity for an existing domain", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "monitor-1" });
    await expect(
      test.service.bootstrap([{ name: "Renamed Vendor", domain: "example.com" }]),
    ).rejects.toThrow("changing its name would diverge from the saved Task input");
    expect(test.monitorRetrieve).not.toHaveBeenCalled();
  });
});

describe("snapshot reconstruction", () => {
  it("replaces changed top-level objects and removes stale basis when new basis is absent", () => {
    const previous = vendorReport({ cybersecurity: "HIGH" });
    const currentCyber = {
      severity: "LOW" as const,
      summary: "The issue is resolved.",
      findings: [],
    };
    const reconstructed = reconstructSnapshotEvent(
      snapshotEvent({
        eventId: "event-1",
        previous,
        changed: { cybersecurity: currentCyber },
        previousBasis: [basis("cybersecurity"), basis("financial_health")],
        changedBasis: [],
      }),
    );
    expect(reconstructed.currentReport.cybersecurity).toEqual(currentCyber);
    expect(reconstructed.currentBasis.map(({ field }) => field)).toEqual([
      "financial_health",
    ]);
  });
});

describe("checkForUpdates", () => {
  it("records a low-signal event without creating a follow-up Task", async () => {
    const test = await runtime();
    const previous = vendorReport();
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValue({
      events: [
        snapshotEvent({
          eventId: "low-event",
          previous,
          changed: {
            financial_health: {
              ...previous.financial_health,
              summary: "A low-risk detail changed.",
            },
          },
        }),
      ],
    });

    const summary = await test.service.checkForUpdates();
    expect(summary).toMatchObject({ newEvents: 1, followUpTasksCreated: 0 });
    expect(test.taskCreate).not.toHaveBeenCalled();
    expect((await test.store.read()).vendors[vendor.domain]?.events["low-event"]?.stage).toBe(
      "completed",
    );
  });

  it("persists and completes one focused follow-up for a high changed dimension", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const highCyber = vendorReport({ cybersecurity: "HIGH" }).cybersecurity;
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValue({
      events: [
        snapshotEvent({
          eventId: "high-event",
          previous,
          changed: { cybersecurity: highCyber },
          changedBasis: [basis("cybersecurity")],
        }),
      ],
    });
    test.taskCreate.mockResolvedValue(taskRun("follow-1"));
    test.taskResult.mockResolvedValue(investigationResult("follow-1"));

    const summary = await test.service.checkForUpdates();
    expect(summary).toMatchObject({
      newEvents: 1,
      followUpDecisions: 1,
      followUpTasksCreated: 1,
      followUpsCompleted: 1,
      humanEscalations: 1,
    });
    expect(test.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        processor: "pro",
        previous_interaction_id: "high-event",
        input: expect.objectContaining({
          monitor_event_id: "high-event",
          changed_fields: ["cybersecurity"],
          policy_decision: expect.objectContaining({
            threshold: "HIGH",
            previousLevel: "LOW",
            currentLevel: "HIGH",
          }),
        }),
      }),
    );
    const entry = (await test.store.read()).vendors[vendor.domain]?.events["high-event"];
    expect(entry?.stage).toBe("completed");
    expect(entry?.followUp?.investigation?.what_changed).toContain("security event");

    await test.service.checkForUpdates();
    expect(test.taskCreate).toHaveBeenCalledTimes(1);
  });

  it("paginates the retained window, deduplicates, and processes oldest first", async () => {
    const test = await runtime();
    const original = vendorReport();
    const afterOld = {
      ...original,
      financial_health: { ...original.financial_health, summary: "Old change" },
    };
    const afterNew = {
      ...afterOld,
      legal_regulatory: { ...afterOld.legal_regulatory, summary: "New change" },
    };
    const oldEvent = snapshotEvent({
      eventId: "old-event",
      previous: original,
      changed: { financial_health: afterOld.financial_health },
    });
    const newEvent = snapshotEvent({
      eventId: "new-event",
      previous: afterOld,
      changed: { legal_regulatory: afterNew.legal_regulatory },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: original });
    test.monitorEvents
      .mockResolvedValueOnce({
        events: [newEvent],
        next_cursor: "older",
        warnings: [{ type: "warning", message: "retained window caveat" }],
      })
      .mockResolvedValueOnce({ events: [oldEvent, newEvent] });

    const summary = await test.service.checkForUpdates();
    expect(summary.newEvents).toBe(2);
    expect(summary.warnings).toContain("monitor-1: retained window caveat");
    const state = await test.store.read();
    expect(Object.keys(state.vendors[vendor.domain]!.events)).toEqual([
      "old-event",
      "new-event",
    ]);
    expect(state.vendors[vendor.domain]?.latest?.eventId).toBe("new-event");
  });

  it("resumes a saved follow-up run without creating another", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const current = vendorReport({ cybersecurity: "HIGH" });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    const decision = decideFollowUp({
      previousReport: previous,
      currentReport: current,
      changedFields: ["cybersecurity"],
      threshold: "HIGH",
    });
    await test.store.update((state) => {
      state.vendors[vendor.domain]!.events["pending-event"] = {
        eventId: "pending-event",
        monitorId: "monitor-1",
        eventDate: "2026-07-09",
        eventGroupId: "group-pending",
        firstSeenAt: fixedNow.toISOString(),
        changedFields: ["cybersecurity"],
        previousReport: previous,
        previousBasis: [],
        previousAssessment: scoreReport(previous),
        currentReport: current,
        currentBasis: [],
        currentAssessment: scoreReport(current),
        decision,
        stage: "follow_up_pending",
        followUp: { runId: "saved-follow-up" },
      };
    });
    test.taskResult.mockResolvedValue(investigationResult("saved-follow-up"));

    const summary = await test.service.checkForUpdates();
    expect(test.taskCreate).not.toHaveBeenCalled();
    expect(summary.followUpsCompleted).toBe(1);
    expect(test.taskResult).toHaveBeenCalledWith(
      "saved-follow-up",
      { timeout: 25 },
      { maxRetries: 0 },
    );
  });

  it("warns when the prior observed event has fallen outside retained history", async () => {
    const test = await runtime();
    const previous = vendorReport();
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    await test.store.update((state) => {
      const monitor = state.vendors[vendor.domain]!.monitor;
      if (monitor?.status === "active") monitor.newestObservedEventId = "expired-event";
    });
    test.monitorEvents.mockResolvedValue({
      events: [
        snapshotEvent({
          eventId: "retained-event",
          previous,
          changed: {
            financial_health: { ...previous.financial_health, summary: "Retained" },
          },
        }),
      ],
    });
    expect((await test.service.checkForUpdates()).warnings[0]).toContain(
      "outside the retained Monitor history",
    );
  });

  it("does not count an escalation for an unrelated low change beside unchanged high risk", async () => {
    const test = await runtime();
    const previous = vendorReport({ cybersecurity: "HIGH" });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValue({
      events: [
        snapshotEvent({
          eventId: "unrelated-low",
          previous,
          changed: {
            financial_health: { ...previous.financial_health, summary: "low detail" },
          },
        }),
      ],
    });
    const summary = await test.service.checkForUpdates();
    expect(summary.followUpDecisions).toBe(0);
    expect(summary.humanEscalations).toBe(0);
  });

  it("does not let a newly discovered older event regress the newest local assessment", async () => {
    const test = await runtime();
    const original = vendorReport();
    const newestReport = {
      ...original,
      cybersecurity: { ...original.cybersecurity, summary: "newest state" },
    };
    const newest = snapshotEvent({
      eventId: "newest",
      previous: original,
      changed: { cybersecurity: newestReport.cybersecurity },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: original });
    test.monitorEvents.mockResolvedValue({ events: [newest] });
    await test.service.checkForUpdates();

    const older = snapshotEvent({
      eventId: "older-unseen",
      previous: original,
      changed: {
        financial_health: { ...original.financial_health, summary: "older state" },
      },
    });
    test.monitorEvents.mockResolvedValue({ events: [newest, older] });
    await test.service.checkForUpdates();
    const state = await test.store.read();
    expect(state.vendors[vendor.domain]?.latest?.eventId).toBe("newest");
    expect(state.vendors[vendor.domain]?.latest?.report.cybersecurity.summary).toBe(
      "newest state",
    );
  });

  it("surfaces each Monitor execution failure once as an error", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "monitor-1" });
    const failure = {
      event_type: "error" as const,
      timestamp: "2026-07-09T11:00:00.000Z",
      error_message: "quota exhausted",
    };
    test.monitorEvents.mockResolvedValue({ events: [failure] });
    expect((await test.service.checkForUpdates()).errors).toEqual([
      "monitor-1 execution error: quota exhausted",
    ]);
    expect((await test.service.checkForUpdates()).errors).toEqual([]);
  });

  it("saves a created follow-up run after a result failure and resumes it next time", async () => {
    const test = await runtime();
    const previous = vendorReport();
    const high = snapshotEvent({
      eventId: "resumable-follow-up",
      previous,
      changed: { cybersecurity: vendorReport({ cybersecurity: "HIGH" }).cybersecurity },
    });
    await seedCompletedVendor(test.store, { monitorId: "monitor-1", report: previous });
    test.monitorEvents.mockResolvedValue({ events: [high] });
    test.taskCreate.mockResolvedValue(taskRun("persisted-follow-up"));
    test.taskResult.mockRejectedValueOnce({ status: 404 });

    expect((await test.service.checkForUpdates()).errors).toHaveLength(1);
    let entry = (await test.store.read()).vendors[vendor.domain]?.events[
      "resumable-follow-up"
    ];
    expect(entry?.followUp?.runId).toBe("persisted-follow-up");
    expect(entry?.lastError?.message).toBe("[object Object]");

    test.monitorEvents.mockResolvedValue({ events: [] });
    test.taskResult.mockResolvedValue(investigationResult("persisted-follow-up"));
    expect((await test.service.checkForUpdates()).followUpsCompleted).toBe(1);
    expect(test.taskCreate).toHaveBeenCalledTimes(1);
    entry = (await test.store.read()).vendors[vendor.domain]?.events["resumable-follow-up"];
    expect(entry?.stage).toBe("completed");
  });

  it("stops newer events for a failed Monitor but continues other Monitors", async () => {
    const test = await runtime();
    const secondVendor: Vendor = { name: "Second", domain: "second.example.com" };
    const previous = vendorReport();
    await seedCompletedVendor(test.store, { monitorId: "first-monitor", report: previous });
    await seedCompletedVendor(test.store, {
      inputVendor: secondVendor,
      monitorId: "second-monitor",
      report: previous,
    });
    const high = snapshotEvent({
      eventId: "failed-high",
      previous,
      changed: { cybersecurity: vendorReport({ cybersecurity: "HIGH" }).cybersecurity },
    });
    const shouldNotRun = snapshotEvent({
      eventId: "newer-first-monitor-event",
      previous,
      changed: {
        financial_health: { ...previous.financial_health, summary: "newer" },
      },
    });
    const secondEvent = snapshotEvent({
      eventId: "second-monitor-event",
      previous,
      changed: {
        legal_regulatory: { ...previous.legal_regulatory, summary: "second" },
      },
    });
    test.monitorEvents.mockImplementation(async (monitorId: string) => ({
      events:
        monitorId === "first-monitor" ? [shouldNotRun, high] : [secondEvent],
    }));
    test.taskCreate.mockRejectedValue(new Error("follow-up create failed"));

    const summary = await test.service.checkForUpdates();
    expect(summary.errors[0]).toContain("follow-up create failed");
    const state = await test.store.read();
    expect(state.vendors[vendor.domain]?.events["failed-high"]?.stage).toBe(
      "follow_up_pending",
    );
    expect(state.vendors[vendor.domain]?.events["newer-first-monitor-event"]).toBeUndefined();
    expect(state.vendors[secondVendor.domain]?.events["second-monitor-event"]?.stage).toBe(
      "completed",
    );
  });
});

describe("cleanup", () => {
  it("attempts every state-owned active Monitor and leaves a failed cancellation active", async () => {
    const test = await runtime();
    const secondVendor: Vendor = { name: "Second", domain: "second.example.com" };
    await seedCompletedVendor(test.store, { monitorId: "monitor-fails" });
    await seedCompletedVendor(test.store, {
      inputVendor: secondVendor,
      monitorId: "monitor-succeeds",
    });
    test.monitorCancel.mockImplementation(async (id: string) => {
      if (id === "monitor-fails") throw new Error("cancel failed");
      return snapshotMonitor(id, "run-second.example.com", "cancelled");
    });
    test.monitorRetrieve.mockResolvedValue(snapshotMonitor("monitor-fails", "run-1", "active"));

    const summary = await test.service.cleanup();
    expect(summary.attempted).toEqual(["monitor-fails", "monitor-succeeds"]);
    expect(summary.cancelled).toEqual(["monitor-succeeds"]);
    expect(summary.failures).toEqual([
      { monitorId: "monitor-fails", message: "cancel failed" },
    ]);
    const state = await test.store.read();
    expect(state.vendors[vendor.domain]?.monitor?.status).toBe("active");
    expect(state.vendors[secondVendor.domain]?.monitor?.status).toBe("cancelled");
    expect(test.monitorList).not.toHaveBeenCalled();
  });

  it("accepts a remote Monitor that was already cancelled after the cancel call fails", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "already-cancelled" });
    test.monitorCancel.mockRejectedValue(new Error("conflict"));
    test.monitorRetrieve.mockResolvedValue(
      snapshotMonitor("already-cancelled", "run-example.com", "cancelled"),
    );

    const summary = await test.service.cleanup();
    expect(summary.cancelled).toEqual(["already-cancelled"]);
    expect(summary.failures).toEqual([]);
    expect((await test.store.read()).vendors[vendor.domain]?.monitor?.status).toBe(
      "cancelled",
    );
  });

  it("continues remote cleanup when persisting an earlier cancellation fails", async () => {
    class FailOnceStore extends FileStateStore {
      failNextUpdate = false;

      override async update(mutator: Parameters<FileStateStore["update"]>[0]) {
        if (this.failNextUpdate) {
          this.failNextUpdate = false;
          throw new Error("disk unavailable");
        }
        return super.update(mutator);
      }
    }

    const directory = await mkdtemp(join(tmpdir(), "vendor-intelligence-failing-store-"));
    directories.push(directory);
    const store = new FailOnceStore(directory);
    const fake = fakeClient();
    const secondVendor: Vendor = { name: "Second", domain: "second.example.com" };
    await seedCompletedVendor(store, { monitorId: "first-monitor" });
    await seedCompletedVendor(store, {
      inputVendor: secondVendor,
      monitorId: "second-monitor",
    });
    store.failNextUpdate = true;
    const service = new VendorIntelligence({
      client: fake.client,
      store,
      config: DEFAULT_CONFIG,
      now: () => fixedNow,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const summary = await service.cleanup();
    expect(fake.monitorCancel).toHaveBeenCalledTimes(2);
    expect(summary.cancelled).toEqual(["first-monitor", "second-monitor"]);
    expect(summary.failures[0]?.message).toContain("local state was not updated");
    const state = await store.read();
    expect(state.vendors[vendor.domain]?.monitor?.status).toBe("active");
    expect(state.vendors[secondVendor.domain]?.monitor?.status).toBe("cancelled");
  });
});
