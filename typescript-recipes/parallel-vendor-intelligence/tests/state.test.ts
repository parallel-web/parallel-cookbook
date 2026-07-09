import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileStateStore } from "../src/state.js";
import { scoreReport } from "../src/risk-policy.js";
import { vendorReport } from "./fixtures.js";

const directories: string[] = [];

async function temporaryStore(): Promise<{ directory: string; store: FileStateStore }> {
  const directory = await mkdtemp(join(tmpdir(), "vendor-intelligence-state-"));
  directories.push(directory);
  return { directory, store: new FileStateStore(directory) };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("FileStateStore", () => {
  it("returns an empty current-version state when the file is absent", async () => {
    const { store } = await temporaryStore();
    await expect(store.read()).resolves.toEqual({
      stateVersion: 1,
      specVersion: 1,
      vendors: {},
    });
  });

  it("atomically preserves successive valid updates", async () => {
    const { store } = await temporaryStore();
    await store.update((state) => {
      state.vendors["example.com"] = {
        vendor: { name: "Example", domain: "example.com" },
        baseline: { stage: "pending" },
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

  it("rejects a map key that does not match the normalized vendor domain without replacing the file", async () => {
    const { store } = await temporaryStore();
    await store.update((state) => {
      state.vendors["example.com"] = {
        vendor: { name: "Example", domain: "example.com" },
        baseline: { stage: "pending" },
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

  it("rejects an active Monitor attached to a different completed baseline", async () => {
    const { store } = await temporaryStore();
    const report = vendorReport();
    await expect(
      store.update((state) => {
        state.vendors["example.com"] = {
          vendor: { name: "Example", domain: "example.com" },
          baseline: {
            stage: "completed",
            runId: "baseline-1",
            report,
            basis: [],
            assessment: scoreReport(report),
            observedAt: "2026-07-09T00:00:00.000Z",
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
    ).rejects.toThrow();
  });
});
