import { afterEach, describe, expect, it } from "vitest";

import { snapshotMonitor } from "./fixtures.js";
import {
  cleanupTestDirectories,
  runtime,
  seedCompletedVendor,
  vendor,
} from "./runtime.js";

afterEach(cleanupTestDirectories);

describe("cleanup", () => {
  it("cancels every state-owned active Monitor and reports failures independently", async () => {
    const test = await runtime();
    const second = { name: "Second", domain: "second.example.com" };
    await seedCompletedVendor(test.store, { monitorId: "first-monitor" });
    await seedCompletedVendor(test.store, { inputVendor: second, monitorId: "second-monitor" });
    test.monitorCancel.mockImplementation(async (monitorId) => {
      if (monitorId === "first-monitor") throw new Error("cannot cancel first");
      return snapshotMonitor(monitorId, "run-second.example.com", "cancelled");
    });
    test.monitorRetrieve.mockImplementation(async (monitorId) =>
      snapshotMonitor(
        monitorId,
        monitorId === "first-monitor" ? "run-example.com" : "run-second.example.com",
      ),
    );

    const summary = await test.service.cleanup();
    expect(summary.monitors).toEqual([
      {
        vendor: "example.com",
        monitorId: "first-monitor",
        status: "failed",
        message: "cannot cancel first",
      },
      {
        vendor: "second.example.com",
        monitorId: "second-monitor",
        status: "cancelled",
      },
    ]);
    expect(test.monitorCancel).toHaveBeenCalledTimes(2);
    const state = await test.store.read();
    expect(state.vendors[vendor.domain]?.monitor?.status).toBe("active");
    expect(state.vendors[second.domain]?.monitor?.status).toBe("cancelled");
  });

  it("accepts a Monitor already cancelled remotely after cancel throws", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "monitor-1" });
    test.monitorCancel.mockRejectedValue(new Error("already cancelled"));
    test.monitorRetrieve.mockResolvedValue(
      snapshotMonitor("monitor-1", "run-example.com", "cancelled"),
    );
    const summary = await test.service.cleanup();
    expect(summary.monitors).toEqual([
      {
        vendor: "example.com",
        monitorId: "monitor-1",
        status: "already_cancelled",
      },
    ]);
    expect((await test.store.read()).vendors[vendor.domain]?.monitor?.status).toBe("cancelled");
  });

  it("reports locally cancelled Monitors consistently during cleanup-all", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, {
      monitorId: "monitor-1",
      monitorStatus: "cancelled",
    });

    const summary = await test.service.cleanup();
    expect(summary.monitors).toEqual([
      {
        vendor: "example.com",
        monitorId: "monitor-1",
        status: "already_cancelled",
      },
    ]);
    expect(test.monitorCancel).not.toHaveBeenCalled();
  });

  it("scopes cancellation to explicitly requested normalized vendors", async () => {
    const test = await runtime();
    const second = { name: "Second", domain: "second.example.com" };
    await seedCompletedVendor(test.store, { monitorId: "first-monitor" });
    await seedCompletedVendor(test.store, { inputVendor: second, monitorId: "second-monitor" });
    test.monitorCancel.mockImplementation(async (monitorId) =>
      snapshotMonitor(monitorId, "run-second.example.com", "cancelled"),
    );

    const summary = await test.service.cleanup({ vendors: ["https://SECOND.example.com/path"] });
    expect(summary.scope).toEqual({ kind: "vendors", vendors: ["second.example.com"] });
    expect(summary.monitors).toEqual([
      {
        vendor: "second.example.com",
        monitorId: "second-monitor",
        status: "cancelled",
      },
    ]);
    expect(test.monitorCancel).toHaveBeenCalledWith("second-monitor");
    expect(test.monitorCancel).not.toHaveBeenCalledWith("first-monitor");
  });

  it("warns instead of calling the API for unknown or monitor-less scoped vendors", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store);
    const summary = await test.service.cleanup({
      vendors: ["missing.example.com", "example.com"],
    });
    expect(summary.warnings.map(({ code }) => code)).toEqual(["unknown_vendor", "no_monitor"]);
    expect(test.monitorCancel).not.toHaveBeenCalled();
  });
});
