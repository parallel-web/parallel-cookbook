import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileStateStore, STATE_VERSION } from "../src/state.js";
import { vendorReport } from "./fixtures.js";

const directories: string[] = [];

async function temporaryStore(): Promise<{ directory: string; store: FileStateStore }> {
  const directory = await mkdtemp(join(tmpdir(), "vendor-intelligence-state-"));
  directories.push(directory);
  return { directory, store: new FileStateStore(directory) };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("FileStateStore", () => {
  it("returns an empty current-version state when the file is absent", async () => {
    const { store } = await temporaryStore();
    await expect(store.read()).resolves.toEqual({
      stateVersion: STATE_VERSION,
      specVersion: 1,
      vendors: {},
    });
  });

  it("validates and preserves successive updates", async () => {
    const { store } = await temporaryStore();
    await store.update((state) => {
      state.vendors["example.com"] = {
        vendor: { name: "Example", domain: "example.com" },
        baseline: { stage: "not_started", failedAttempts: [] },
        events: {},
      };
    });
    await store.update((state) => {
      state.vendors["example.com"]!.vendor.riskFloor = "HIGH";
    });
    expect((await store.read()).vendors["example.com"]?.vendor.riskFloor).toBe("HIGH");
  });

  it("fails loudly on malformed state and ignores stray temporary files", async () => {
    const { directory, store } = await temporaryStore();
    await writeFile(join(directory, "state.json.tmp-orphan"), "not json");
    await expect(store.read()).resolves.toMatchObject({ vendors: {} });
    await writeFile(store.statePath, "not json");
    await expect(store.read()).rejects.toThrow(store.statePath);
  });

  it("rejects mismatched vendor keys without replacing the valid file", async () => {
    const { store } = await temporaryStore();
    await store.update((state) => {
      state.vendors["example.com"] = {
        vendor: { name: "Example", domain: "example.com" },
        baseline: { stage: "not_started", failedAttempts: [] },
        events: {},
      };
    });
    const before = await readFile(store.statePath, "utf8");
    await expect(
      store.update((state) => {
        state.vendors["wrong.example"] = state.vendors["example.com"]!;
      }),
    ).rejects.toThrow();
    expect(await readFile(store.statePath, "utf8")).toBe(before);
  });

  it("rejects an active Monitor attached to a different baseline", async () => {
    const { store } = await temporaryStore();
    const report = vendorReport();
    await expect(
      store.update((state) => {
        state.vendors["example.com"] = {
          vendor: { name: "Example", domain: "example.com" },
          baseline: {
            stage: "completed",
            run: {
              runId: "baseline-1",
              interactionId: "interaction-1",
              startedAt: "2026-07-09T00:00:00.000Z",
            },
            failedAttempts: [],
            evidence: {
              report,
              basis: [],
              observedAt: "2026-07-09T00:00:00.000Z",
              warnings: [],
            },
          },
          monitor: {
            status: "active",
            monitorId: "monitor-1",
            baselineRunId: "different-baseline",
            frequency: "1d",
            processor: "lite",
            createdAt: "2026-07-09T00:00:00.000Z",
          },
          events: {},
        };
      }),
    ).rejects.toThrow("baseline does not match");
  });

  it("serializes commands across independent store instances", async () => {
    const { directory, store } = await temporaryStore();
    const other = new FileStateStore(directory);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = store.withCommandLock("bootstrap", async () => {
      entered();
      await gate;
      return "done";
    });
    await acquired;
    await expect(
      other.withCommandLock("check-updates", async () => "should not run"),
    ).rejects.toThrow("Another vendor-intelligence command is active");
    release();
    await expect(first).resolves.toBe("done");
    await expect(other.withCommandLock("cleanup", async () => "released")).resolves.toBe(
      "released",
    );
  });

  it("releases the command lock after the action throws", async () => {
    const { store } = await temporaryStore();
    await expect(
      store.withCommandLock("bootstrap", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(store.withCommandLock("cleanup", async () => "ok")).resolves.toBe("ok");
  });

  it("reclaims a dead same-host owner but not a fresh malformed lock", async () => {
    const { store } = await temporaryStore();
    await writeFile(
      store.lockPath,
      `${JSON.stringify({
        version: 1,
        token: randomUUID(),
        pid: 2_147_483_647,
        hostname: hostname(),
        command: "bootstrap",
        acquiredAt: "2026-07-09T00:00:00.000Z",
      })}\n`,
    );
    await expect(store.withCommandLock("cleanup", async () => "reclaimed")).resolves.toBe(
      "reclaimed",
    );

    await writeFile(store.lockPath, "");
    await expect(store.withCommandLock("cleanup", async () => "unsafe")).rejects.toThrow(
      "Another vendor-intelligence command is active",
    );
    const old = new Date(Date.now() - 31_000);
    await utimes(store.lockPath, old, old);
    await expect(store.withCommandLock("cleanup", async () => "old-reclaimed")).resolves.toBe(
      "old-reclaimed",
    );
  });

  it("allows only one contender to reclaim a stale lock", async () => {
    const { directory, store } = await temporaryStore();
    const other = new FileStateStore(directory);
    await writeFile(
      store.lockPath,
      `${JSON.stringify({
        version: 1,
        token: randomUUID(),
        pid: 2_147_483_647,
        hostname: hostname(),
        command: "stale",
        acquiredAt: "2026-07-09T00:00:00.000Z",
      })}\n`,
    );

    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstEntry!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      firstEntry = resolve;
    });
    const action = async () => {
      entered += 1;
      firstEntry();
      await gate;
      return "entered";
    };
    const attempts = [
      store.withCommandLock("first", action),
      other.withCommandLock("second", action),
    ];
    const settled = Promise.allSettled(attempts);

    await firstEntered;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(entered).toBe(1);
    release();
    const results = await settled;
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });

  it("identifies an orphaned stale-lock recovery marker", async () => {
    const { store } = await temporaryStore();
    const deadOwner = {
      version: 1,
      token: randomUUID(),
      pid: 2_147_483_647,
      hostname: hostname(),
      command: "cleanup",
      acquiredAt: "2026-07-09T00:00:00.000Z",
    };
    await writeFile(store.lockPath, `${JSON.stringify(deadOwner)}\n`);
    await writeFile(`${store.lockPath}.reclaim`, `${JSON.stringify(deadOwner)}\n`);

    await expect(
      store.withCommandLock("cleanup", async () => "unsafe"),
    ).rejects.toThrow(`${store.lockPath}.reclaim`);

    await rm(`${store.lockPath}.reclaim`);
    await expect(store.withCommandLock("cleanup", async () => "reclaimed")).resolves.toBe(
      "reclaimed",
    );
  });

  it("does not delete a replacement lock owned by another token", async () => {
    const { store } = await temporaryStore();
    const replacement = {
      version: 1,
      token: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      command: "replacement",
      acquiredAt: new Date().toISOString(),
    };
    await store.withCommandLock("bootstrap", async () => {
      await writeFile(store.lockPath, `${JSON.stringify(replacement)}\n`);
    });
    expect(JSON.parse(await readFile(store.lockPath, "utf8"))).toMatchObject({
      token: replacement.token,
    });
  });

  it("rejects unsupported state versions", async () => {
    const { store } = await temporaryStore();
    const unsupported = {
      stateVersion: 99,
      specVersion: 1,
      vendors: {},
    };
    await writeFile(store.statePath, `${JSON.stringify(unsupported)}\n`);
    await expect(store.read()).rejects.toThrow("Cannot read vendor intelligence state");
  });

  it("keeps historical decisions readable across policy-version changes", async () => {
    const { store } = await temporaryStore();
    const report = vendorReport();
    await store.update((state) => {
      state.vendors["example.com"] = {
        vendor: { name: "Example", domain: "example.com" },
        baseline: { stage: "not_started", failedAttempts: [] },
        events: {
          historical: {
            stage: "completed_without_follow_up",
            eventId: "historical",
            monitorId: "monitor-old",
            eventDate: "2026-07-09",
            eventGroupId: "group-historical",
            firstSeenAt: "2026-07-09T00:00:00.000Z",
            previousReport: report,
            previousBasis: [],
            currentReport: report,
            currentBasis: [],
            decision: {
              runFollowUp: false,
              threshold: "HIGH",
              previousLevel: "LOW",
              currentLevel: "LOW",
              changedFields: ["financial_health"],
              requiresHumanReview: false,
              reasons: [],
              policyVersion: 99,
              evaluatedAt: "2026-07-09T00:00:00.000Z",
            },
            completedAt: "2026-07-09T00:00:00.000Z",
          },
        },
        latestEventId: "historical",
      };
    });

    const historical = (await store.read()).vendors["example.com"]?.events.historical;
    expect(historical?.stage).toBe("completed_without_follow_up");
    if (!historical || historical.stage === "event_failed") {
      throw new Error("missing historical event");
    }
    expect(historical.decision.policyVersion).toBe(99);
  });

  it("reads legacy failed events that predate persisted prior snapshots", async () => {
    const { store } = await temporaryStore();
    const report = vendorReport();
    const observedAt = "2026-07-09T00:00:00.000Z";
    await writeFile(
      store.statePath,
      `${JSON.stringify({
        stateVersion: STATE_VERSION,
        specVersion: 1,
        vendors: {
          "example.com": {
            vendor: { name: "Example", domain: "example.com" },
            baseline: {
              stage: "completed",
              run: { runId: "baseline-1", interactionId: "interaction-1" },
              failedAttempts: [],
              evidence: { report, basis: [], observedAt, warnings: [] },
            },
            monitor: {
              status: "active",
              monitorId: "monitor-1",
              baselineRunId: "baseline-1",
              frequency: "1d",
              processor: "lite",
              createdAt: observedAt,
              newestObservedEventId: "legacy-failure",
            },
            events: {
              "legacy-failure": {
                stage: "event_failed",
                eventId: "legacy-failure",
                monitorId: "monitor-1",
                eventDate: "2026-07-09",
                eventGroupId: "group-legacy-failure",
                firstSeenAt: observedAt,
                rawEvent: {
                  eventId: "legacy-failure",
                  eventGroupId: "group-legacy-failure",
                  eventDate: "2026-07-09",
                  previousOutput: { type: "json", content: {}, basis: [] },
                  changedOutput: {
                    type: "json",
                    content: { unknown_field: true },
                    basis: [],
                  },
                },
                failure: {
                  kind: "invalid_event",
                  message: "legacy validation failure",
                  failedAt: observedAt,
                  attempts: 1,
                },
              },
            },
          },
        },
      })}\n`,
    );

    const failed = (await store.read()).vendors["example.com"]?.events[
      "legacy-failure"
    ];
    expect(failed?.stage).toBe("event_failed");
    if (!failed || failed.stage !== "event_failed") throw new Error("missing failure");
    expect(failed.priorSnapshot).toBeUndefined();
  });
});
