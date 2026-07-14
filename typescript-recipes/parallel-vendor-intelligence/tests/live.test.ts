import "dotenv/config";

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Parallel from "parallel-web";
import { describe, expect, it, vi } from "vitest";

import type { ParallelPort } from "../src/parallel-port.js";
import { createParallelPort } from "../src/parallel-sdk-adapter.js";
import { RECIPE_METADATA, SPEC_VERSION } from "../src/schema.js";
import { emptyRecipeState, FileStateStore } from "../src/state.js";
import { DEFAULT_CONFIG } from "../src/vendor-config.js";
import { VendorIntelligence } from "../src/vendor-intelligence.js";
import { snapshotMonitor, vendorReport } from "./fixtures.js";
import { fakeClient } from "./runtime.js";

const liveTest = process.env.RUN_LIVE_TESTS === "1" ? it : it.skip;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function finalizeLiveTest(input: {
  directory: string;
  client: ParallelPort;
  service: Pick<VendorIntelligence, "cleanup">;
  store: Pick<FileStateStore, "read">;
  monitorIds: Set<string>;
}): Promise<void> {
  const failures: Error[] = [];
  const recordFailure = (operation: string, error: unknown) => {
    failures.push(new Error(`${operation}: ${errorMessage(error)}`, { cause: error }));
  };
  const stateOwnedIds = new Set(input.monitorIds);

  try {
    try {
      const cleanup = await input.service.cleanup();
      for (const monitorId of stateOwnedIds) {
        const result = cleanup.monitors.find((monitor) => monitor.monitorId === monitorId);
        if (!result || result.status === "failed") {
          recordFailure(
            `State-owned cleanup did not cancel Monitor ${monitorId}`,
            result?.status === "failed" ? result.message : "Monitor was missing from the result",
          );
        }
      }
    } catch (error) {
      recordFailure("State-owned cleanup failed", error);
    }

    try {
      const state = await input.store.read();
      const baseline = state.vendors["cloudflare.com"]?.baseline;
      if (baseline?.stage === "completed") {
        let cursor: string | undefined;
        const seenCursors = new Set<string>();
        do {
          const page = await input.client.monitor.list({
            limit: 100,
            status: ["active"],
            type: ["snapshot"],
            ...(cursor ? { cursor } : {}),
          });
          for (const monitor of page.monitors) {
            if (
              monitor.type === "snapshot" &&
              monitor.settings.task_run_id === baseline.run.runId &&
              monitor.frequency === "30d" &&
              monitor.processor === "lite" &&
              monitor.metadata?.recipe === RECIPE_METADATA &&
              monitor.metadata.vendor === "cloudflare.com" &&
              monitor.metadata.spec === String(SPEC_VERSION)
            ) {
              input.monitorIds.add(monitor.monitor_id);
            }
          }
          const next = page.next_cursor ?? undefined;
          if (next && seenCursors.has(next)) throw new Error("Repeated live-test cursor.");
          if (next) seenCursors.add(next);
          cursor = next;
        } while (cursor);
      }
    } catch (error) {
      recordFailure("Fallback Monitor discovery failed", error);
    }

    for (const monitorId of input.monitorIds) {
      let cancellationError: unknown;
      try {
        await input.client.monitor.cancel(monitorId);
      } catch (error) {
        cancellationError = error;
      }

      try {
        const remote = await input.client.monitor.retrieve(monitorId);
        if (remote.status !== "cancelled") {
          throw new Error(`Monitor remained ${remote.status}.`);
        }
        console.error(`Confirmed cancelled Monitor ${monitorId}.`);
      } catch (error) {
        recordFailure(
          `Could not confirm cancellation of Monitor ${monitorId}`,
          cancellationError && error !== cancellationError
            ? new AggregateError([cancellationError, error], "Cancellation was not confirmed.")
            : error,
        );
      }
    }
  } finally {
    try {
      await rm(input.directory, { recursive: true, force: true });
    } catch (error) {
      recordFailure("Temporary-directory cleanup failed", error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "The live test could not complete all cleanup steps.");
  }
}

describe("live-test cleanup", () => {
  it("still cancels known Monitors when discovery fails and continues after one ID fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vendor-intelligence-finalizer-"));
    const fake = fakeClient();
    const cancelled = new Set<string>();
    fake.monitorList.mockRejectedValue(new Error("list unavailable"));
    fake.monitorCancel.mockImplementation(async (monitorId) => {
      if (monitorId === "unreachable") throw new Error("cancel unavailable");
      cancelled.add(monitorId);
      return snapshotMonitor(monitorId, "baseline-live", "cancelled");
    });
    fake.monitorRetrieve.mockImplementation(async (monitorId) => {
      if (monitorId === "unreachable") throw new Error("retrieve unavailable");
      return snapshotMonitor(
        monitorId,
        "baseline-live",
        cancelled.has(monitorId) ? "cancelled" : "active",
      );
    });
    const state = emptyRecipeState();
    state.vendors["cloudflare.com"] = {
      vendor: { name: "Cloudflare", domain: "cloudflare.com" },
      baseline: {
        stage: "completed",
        run: { runId: "baseline-live" },
        failedAttempts: [],
        evidence: {
          report: vendorReport(),
          basis: [],
          observedAt: "2026-07-09T00:00:00.000Z",
          warnings: [],
        },
      },
      events: {},
    };

    await expect(
      finalizeLiveTest({
        directory,
        client: fake.client,
        service: { cleanup: vi.fn().mockRejectedValue(new Error("cleanup unavailable")) },
        store: { read: vi.fn().mockResolvedValue(state) },
        monitorIds: new Set(["unreachable", "known"]),
      }),
    ).rejects.toThrow("could not complete all cleanup steps");

    expect(fake.monitorList).toHaveBeenCalledOnce();
    expect(fake.monitorCancel).toHaveBeenCalledWith("unreachable");
    expect(fake.monitorCancel).toHaveBeenCalledWith("known");
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("live production lifecycle", () => {
  liveTest(
    "bootstraps, checks, and confirms state-owned Monitor cancellation",
    async () => {
      const apiKey = process.env.PARALLEL_API_KEY;
      if (!apiKey) throw new Error("PARALLEL_API_KEY is required for the live test.");

      const directory = await mkdtemp(join(tmpdir(), "vendor-intelligence-live-"));
      const production = createParallelPort(new Parallel({ apiKey, timeout: 60_000 }));
      const monitorIds = new Set<string>();
      const client = {
        ...production,
        monitor: {
          ...production.monitor,
          async create(params, options) {
            const monitor = await production.monitor.create(params, options);
            monitorIds.add(monitor.monitor_id);
            return monitor;
          },
        },
      } satisfies ParallelPort;
      const store = new FileStateStore(directory);
      const service = new VendorIntelligence({
        client,
        store,
        config: { ...DEFAULT_CONFIG, monitorFrequency: "30d" },
      });

      try {
        const bootstrap = await service.bootstrap([
          { name: "Cloudflare", domain: "cloudflare.com" },
        ]);
        const monitorId = bootstrap.results[0]?.monitor.monitorId;
        if (monitorId) monitorIds.add(monitorId);
        expect(bootstrap.results).toHaveLength(1);
        expect(bootstrap.results[0]?.assessment.basis.length).toBeGreaterThan(0);
        expect(monitorId).toBeTruthy();

        const check = await service.checkForUpdates();
        expect(check.monitorsChecked).toBe(1);
        expect(check.errors).toEqual([]);
      } finally {
        await finalizeLiveTest({ directory, client, service, store, monitorIds });
      }
    },
    20 * 60 * 1_000,
  );
});
