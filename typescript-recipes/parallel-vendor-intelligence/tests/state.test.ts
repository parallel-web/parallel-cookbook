import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileStateStore, STATE_VERSION } from "../src/state.js";
import { basis, investigation, vendorReport } from "./fixtures.js";

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

function legacyEvent(
  eventId: string,
  options: {
    runFollowUp: boolean;
    stage: "follow_up_pending" | "completed";
    followUp?: Record<string, unknown>;
  },
) {
  const report = vendorReport();
  return {
    eventId,
    monitorId: "monitor-1",
    eventDate: "2026-07-09",
    eventGroupId: `group-${eventId}`,
    firstSeenAt: "2026-07-09T01:00:00.000Z",
    changedFields: ["financial_health"],
    previousReport: report,
    previousBasis: [],
    previousAssessment: { stale: true },
    currentReport: report,
    currentBasis: [],
    currentAssessment: { stale: true },
    decision: {
      runFollowUp: options.runFollowUp,
      threshold: "HIGH",
      previousLevel: "LOW",
      currentLevel: "LOW",
      changedFields: ["financial_health"],
      requiresHumanReview: options.runFollowUp,
      reasons: options.runFollowUp
        ? [{ kind: "vendor_floor", level: "HIGH" }]
        : [],
    },
    stage: options.stage,
    ...(options.followUp ? { followUp: options.followUp } : {}),
    ...(options.stage === "completed"
      ? { completedAt: "2026-07-09T02:00:00.000Z" }
      : {}),
  };
}

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

  it("migrates v1 on read and writes a one-time backup before the first v2 update", async () => {
    const { store } = await temporaryStore();
    const legacy = {
      stateVersion: 1,
      specVersion: 1,
      vendors: {
        "example.com": {
          vendor: { name: "Example", domain: "example.com" },
          baseline: { stage: "pending" },
          events: {},
        },
      },
    };
    await writeFile(store.statePath, `${JSON.stringify(legacy)}\n`);
    expect((await store.read()).vendors["example.com"]?.baseline.stage).toBe("not_started");
    expect(JSON.parse(await readFile(store.statePath, "utf8")).stateVersion).toBe(1);

    await store.update((state) => {
      state.vendors["example.com"]!.vendor.riskFloor = "MEDIUM";
    });
    expect(JSON.parse(await readFile(store.statePath, "utf8")).stateVersion).toBe(2);
    expect(JSON.parse(await readFile(`${store.statePath}.v1.bak`, "utf8"))).toEqual(legacy);
  });

  it("migrates completed v1 lifecycle states without inventing Task start times", async () => {
    const { store } = await temporaryStore();
    const report = vendorReport();
    const legacy = {
      stateVersion: 1,
      specVersion: 1,
      vendors: {
        "example.com": {
          vendor: { name: "Example", domain: "example.com", riskFloor: "HIGH" },
          baseline: {
            stage: "completed",
            runId: "baseline-1",
            interactionId: "interaction-1",
            report,
            basis: [basis("cybersecurity")],
            assessment: { stale: true },
            observedAt: "2026-07-09T00:30:00.000Z",
          },
          monitor: {
            status: "active",
            monitorId: "monitor-1",
            baselineRunId: "baseline-1",
            frequency: "1d",
            processor: "lite",
            createdAt: "2026-07-09T00:45:00.000Z",
          },
          events: {
            noFollowUp: legacyEvent("noFollowUp", {
              runFollowUp: false,
              stage: "completed",
            }),
            queued: legacyEvent("queued", {
              runFollowUp: true,
              stage: "follow_up_pending",
            }),
            running: legacyEvent("running", {
              runFollowUp: true,
              stage: "follow_up_pending",
              followUp: { runId: "follow-running" },
            }),
            completed: legacyEvent("completed", {
              runFollowUp: true,
              stage: "completed",
              followUp: {
                runId: "follow-completed",
                investigation,
                basis: [basis("what_changed")],
                warnings: ["warning"],
                completedAt: "2026-07-09T03:00:00.000Z",
              },
            }),
          },
          latest: { eventId: "completed", derivedAssessment: { stale: true } },
        },
      },
    };
    await writeFile(store.statePath, `${JSON.stringify(legacy)}\n`);

    const migrated = await store.read();
    const saved = migrated.vendors["example.com"];
    expect(saved?.baseline.stage).toBe("completed");
    if (saved?.baseline.stage !== "completed") throw new Error("missing baseline");
    expect(saved.baseline.run.startedAt).toBeUndefined();
    expect(saved.events.noFollowUp?.stage).toBe("completed_without_follow_up");
    expect(saved.events.queued?.stage).toBe("follow_up_queued");
    expect(saved.events.running?.stage).toBe("follow_up_running");
    expect(saved.events.completed?.stage).toBe("follow_up_completed");
    const running = saved.events.running;
    const completed = saved.events.completed;
    expect(running?.stage === "follow_up_running" ? running.run.startedAt : null).toBeUndefined();
    expect(completed?.stage === "follow_up_completed" ? completed.run.startedAt : null).toBeUndefined();
    expect(
      completed?.stage === "follow_up_completed" ? completed.decision.riskFloor : null,
    ).toBeUndefined();
    expect(
      completed?.stage === "follow_up_completed" ? completed.decision.policyVersion : null,
    ).toBe(1);
    expect(saved.latestEventId).toBe("completed");
  });

  it("rejects an incomplete v1 event marked as a completed follow-up", async () => {
    const { store } = await temporaryStore();
    const legacy = {
      stateVersion: 1,
      specVersion: 1,
      vendors: {
        "example.com": {
          vendor: { name: "Example", domain: "example.com" },
          baseline: { stage: "pending" },
          events: {
            incomplete: legacyEvent("incomplete", {
              runFollowUp: true,
              stage: "completed",
              followUp: { runId: "follow-incomplete" },
            }),
          },
        },
      },
    };
    await writeFile(store.statePath, `${JSON.stringify(legacy)}\n`);

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
});
