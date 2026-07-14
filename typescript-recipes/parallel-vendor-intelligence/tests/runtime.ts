import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import type { ParallelPort } from "../src/parallel-port.js";
import type { Vendor, VendorReport } from "../src/schema.js";
import { FileStateStore } from "../src/state.js";
import {
  VendorIntelligence,
} from "../src/vendor-intelligence.js";
import {
  DEFAULT_CONFIG,
  type VendorIntelligenceConfig,
} from "../src/vendor-config.js";
import {
  investigationResult,
  reportResult,
  snapshotMonitor,
  taskRun,
  vendorReport,
} from "./fixtures.js";

export const vendor: Vendor = { name: "Example", domain: "example.com" };
export const fixedNow = new Date("2026-07-09T12:00:00.000Z");

const directories: string[] = [];

export function fakeClient() {
  const taskCreate = vi.fn<ParallelPort["taskRun"]["create"]>(async () => taskRun());
  const taskRetrieve = vi.fn<ParallelPort["taskRun"]["retrieve"]>(async (runId) =>
    taskRun(runId),
  );
  const taskResult = vi.fn<ParallelPort["taskRun"]["result"]>(async () =>
    reportResult(vendorReport()),
  );
  const monitorCreate = vi.fn<ParallelPort["monitor"]["create"]>(async (params) =>
    snapshotMonitor("monitor-1", params.settings.task_run_id),
  );
  const monitorRetrieve = vi.fn<ParallelPort["monitor"]["retrieve"]>(async () =>
    snapshotMonitor(),
  );
  const monitorList = vi.fn<ParallelPort["monitor"]["list"]>(async () => ({
    monitors: [],
  }));
  const monitorEvents = vi.fn<ParallelPort["monitor"]["events"]>(async () => ({
    events: [],
  }));
  const monitorCancel = vi.fn<ParallelPort["monitor"]["cancel"]>(async (id) =>
    snapshotMonitor(id, "run-1", "cancelled"),
  );
  const client = {
    taskRun: { create: taskCreate, retrieve: taskRetrieve, result: taskResult },
    monitor: {
      create: monitorCreate,
      retrieve: monitorRetrieve,
      list: monitorList,
      events: monitorEvents,
      cancel: monitorCancel,
    },
  } satisfies ParallelPort;
  return {
    client,
    taskCreate,
    taskRetrieve,
    taskResult,
    monitorCreate,
    monitorRetrieve,
    monitorList,
    monitorEvents,
    monitorCancel,
  };
}

export async function runtime(
  fake = fakeClient(),
  config: Partial<VendorIntelligenceConfig> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "vendor-intelligence-runtime-"));
  directories.push(directory);
  const store = new FileStateStore(directory);
  const reporter = vi.fn<(message: string) => void>();
  const service = new VendorIntelligence({
    client: fake.client,
    store,
    config: { ...DEFAULT_CONFIG, ...config },
    now: () => fixedNow,
    sleep: async () => {},
    reporter,
  });
  return { ...fake, directory, store, service, reporter };
}

export async function seedCompletedVendor(
  store: FileStateStore,
  options: {
    inputVendor?: Vendor;
    report?: VendorReport;
    monitorId?: string;
    monitorStatus?: "active" | "cancelled";
  } = {},
): Promise<void> {
  const inputVendor = options.inputVendor ?? vendor;
  const report = options.report ?? vendorReport();
  const observedAt = fixedNow.toISOString();
  await store.update((state) => {
    state.vendors[inputVendor.domain] = {
      vendor: inputVendor,
      baseline: {
        stage: "completed",
        run: {
          runId: `run-${inputVendor.domain}`,
          interactionId: `interaction-run-${inputVendor.domain}`,
          startedAt: observedAt,
        },
        failedAttempts: [],
        evidence: { report, basis: [], observedAt, warnings: [] },
      },
      monitor: options.monitorId
        ? options.monitorStatus === "cancelled"
          ? {
              status: "cancelled",
              monitorId: options.monitorId,
              baselineRunId: `run-${inputVendor.domain}`,
              frequency: "1d",
              processor: "lite",
              createdAt: observedAt,
              cancelledAt: observedAt,
            }
          : {
              status: "active",
              monitorId: options.monitorId,
              baselineRunId: `run-${inputVendor.domain}`,
              frequency: "1d",
              processor: "lite",
              createdAt: observedAt,
            }
        : undefined,
      events: {},
    };
  });
}

export async function cleanupTestDirectories(): Promise<void> {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

export function completedInvestigationResult(runId = "follow-1") {
  return investigationResult(runId);
}
