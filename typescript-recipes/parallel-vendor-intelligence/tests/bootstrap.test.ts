import { afterEach, describe, expect, it } from "vitest";

import { basis, reportResult, snapshotMonitor, taskRun, vendorReport } from "./fixtures.js";
import {
  cleanupTestDirectories,
  fixedNow,
  runtime,
  seedCompletedVendor,
  vendor,
} from "./runtime.js";

afterEach(cleanupTestDirectories);

describe("bootstrap", () => {
  it("rejects empty and duplicate input before any API call", async () => {
    const test = await runtime();
    await expect(test.service.bootstrap([])).rejects.toThrow("at least one vendor");
    await expect(
      test.service.bootstrap([
        vendor,
        { name: "Duplicate", domain: "https://EXAMPLE.com/path" },
      ]),
    ).rejects.toThrow("duplicate normalized domain example.com");
    expect(test.taskCreate).not.toHaveBeenCalled();
    expect(test.monitorCreate).not.toHaveBeenCalled();
  });

  it("returns the cited baseline and reuses its Task and Monitor", async () => {
    const test = await runtime();
    const first = await test.service.bootstrap([vendor]);

    expect(first).toMatchObject({
      baselinesCreated: 1,
      baselinesResumed: 0,
      monitorsCreated: 1,
      results: [
        {
          vendor,
          baseline: { action: "created", runId: "run-1" },
          monitor: { action: "created", monitorId: "monitor-1" },
          assessment: {
            source: { kind: "baseline", runId: "run-1" },
            report: vendorReport(),
            basis: [basis("cybersecurity")],
            risk: { level: "LOW", policyVersion: 1 },
          },
        },
      ],
    });
    expect(test.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        processor: "core",
        input: expect.objectContaining({ vendor_domain: "example.com" }),
      }),
      { maxRetries: 0 },
    );
    expect(test.monitorCreate).toHaveBeenCalledWith(
      {
        type: "snapshot",
        frequency: "1d",
        processor: "lite",
        settings: { task_run_id: "run-1" },
        metadata: { recipe: "vendor-intel", vendor: "example.com", spec: "1" },
      },
      { maxRetries: 0 },
    );

    const second = await test.service.bootstrap([vendor]);
    expect(second).toMatchObject({
      baselinesReused: 1,
      monitorsReused: 1,
      results: [
        {
          baseline: { action: "reused" },
          monitor: { action: "reused" },
        },
      ],
    });
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
          run: {
            runId: "saved-run",
            interactionId: "interaction-saved-run",
            startedAt: fixedNow.toISOString(),
          },
          failedAttempts: [],
        },
        events: {},
      };
    });
    test.taskResult.mockResolvedValue(reportResult(vendorReport(), "saved-run"));
    const summary = await test.service.bootstrap([vendor]);
    expect(summary.baselinesResumed).toBe(1);
    expect(summary.results[0]?.baseline.action).toBe("resumed");
    expect(test.taskCreate).not.toHaveBeenCalled();
  });

  it("polls a still-running Task but leaves transport failures resumable", async () => {
    const retrying = await runtime();
    retrying.taskResult
      .mockRejectedValueOnce({ status: 408 })
      .mockResolvedValueOnce(reportResult(vendorReport()));
    await retrying.service.bootstrap([vendor]);
    expect(retrying.taskResult).toHaveBeenCalledTimes(2);
    expect(retrying.taskRetrieve).toHaveBeenCalledWith("run-1");

    const transport = await runtime();
    transport.taskResult.mockRejectedValue({ status: 503, message: "unavailable" });
    await expect(transport.service.bootstrap([vendor])).rejects.toMatchObject({ status: 503 });
    expect((await transport.store.read()).vendors[vendor.domain]?.baseline.stage).toBe(
      "running",
    );
  });

  it("persists terminal Task failure and spends again only with --retry-failed", async () => {
    const test = await runtime();
    test.taskCreate
      .mockResolvedValueOnce(taskRun("failed-run"))
      .mockResolvedValueOnce(taskRun("replacement-run"));
    test.taskResult
      .mockRejectedValueOnce({ status: 422, message: "failed" })
      .mockResolvedValueOnce(reportResult(vendorReport(), "replacement-run"));
    test.taskRetrieve.mockResolvedValueOnce({
      ...taskRun("failed-run"),
      status: "failed",
      error: { message: "research failed", ref_id: "ref-1" },
    });

    await expect(test.service.bootstrap([vendor])).rejects.toThrow("--retry-failed");
    const failed = (await test.store.read()).vendors[vendor.domain]?.baseline;
    expect(failed?.stage).toBe("failed");
    if (failed?.stage !== "failed") throw new Error("missing failed baseline");
    expect(failed.failedAttempts[0]).toMatchObject({
      kind: "remote_terminal",
      status: "failed",
      message: "research failed",
      refId: "ref-1",
    });

    await expect(test.service.bootstrap([vendor])).rejects.toThrow("--retry-failed");
    expect(test.taskCreate).toHaveBeenCalledTimes(1);

    const retried = await test.service.bootstrap([vendor], { retryFailed: true });
    expect(retried.results[0]?.baseline.runId).toBe("replacement-run");
    expect(test.taskCreate).toHaveBeenCalledTimes(2);
    const completed = (await test.store.read()).vendors[vendor.domain]?.baseline;
    expect(completed?.stage).toBe("completed");
    if (completed?.stage !== "completed") throw new Error("missing completed baseline");
    expect(completed.failedAttempts).toHaveLength(1);
  });

  it("treats a completed Task with invalid output as an explicit failed attempt", async () => {
    const test = await runtime();
    test.taskResult.mockResolvedValue({
      run: { ...taskRun("run-1"), status: "completed" },
      output: { type: "text", content: "not structured", basis: [] },
    });
    await expect(test.service.bootstrap([vendor])).rejects.toThrow("--retry-failed");
    const baseline = (await test.store.read()).vendors[vendor.domain]?.baseline;
    expect(baseline?.stage).toBe("failed");
    if (baseline?.stage !== "failed") throw new Error("missing failed baseline");
    expect(baseline.failedAttempts[0]?.kind).toBe("invalid_output");
  });

  it("treats an invalid completed Task basis as an explicit failed attempt", async () => {
    const test = await runtime();
    test.taskResult.mockResolvedValue({
      ...reportResult(vendorReport()),
      output: {
        type: "json",
        content: vendorReport(),
        basis: "not-a-basis-array",
      },
    });

    await expect(test.service.bootstrap([vendor])).rejects.toThrow("--retry-failed");
    const baseline = (await test.store.read()).vendors[vendor.domain]?.baseline;
    expect(baseline?.stage).toBe("failed");
    if (baseline?.stage !== "failed") throw new Error("missing failed baseline");
    expect(baseline.failedAttempts[0]).toMatchObject({ kind: "invalid_output" });
    expect(baseline.failedAttempts[0]?.message).toContain("invalid evidence basis");
  });

  it("paginates and adopts exactly one matching orphan Monitor", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store);
    const unrelated = snapshotMonitor("unrelated", "other-run");
    const adopted = snapshotMonitor("adopted", "run-example.com");
    test.monitorList
      .mockResolvedValueOnce({ monitors: [unrelated], next_cursor: "next" })
      .mockResolvedValueOnce({ monitors: [adopted] });
    const summary = await test.service.bootstrap([vendor]);
    expect(summary.monitorsAdopted).toBe(1);
    expect(summary.results[0]?.monitor).toMatchObject({
      action: "adopted",
      monitorId: "adopted",
    });
    expect(test.monitorCreate).not.toHaveBeenCalled();
  });

  it("re-scans and adopts after an ambiguous Monitor create failure", async () => {
    const test = await runtime();
    const recovered = snapshotMonitor("recovered", "run-1");
    test.monitorList
      .mockResolvedValueOnce({ monitors: [] })
      .mockResolvedValueOnce({ monitors: [recovered] });
    test.monitorCreate.mockRejectedValue({ status: 503, message: "response lost" });

    const summary = await test.service.bootstrap([vendor]);
    expect(summary).toMatchObject({ monitorsCreated: 0, monitorsAdopted: 1 });
    expect(summary.results[0]?.monitor).toMatchObject({
      action: "adopted",
      monitorId: "recovered",
    });
    expect(test.monitorCreate).toHaveBeenCalledOnce();
    expect(test.monitorList).toHaveBeenCalledTimes(2);
  });

  it("gives safe retry guidance when an ambiguous Monitor create is not yet discoverable", async () => {
    const test = await runtime();
    test.monitorList.mockResolvedValue({ monitors: [] });
    test.monitorCreate.mockRejectedValue({ status: 503, message: "response lost" });

    await expect(test.service.bootstrap([vendor])).rejects.toThrow(
      "Re-run bootstrap; it will adopt any matching Monitor",
    );
    expect(test.monitorList).toHaveBeenCalledTimes(2);
  });

  it("cancels a newly created Monitor whose response does not match the request", async () => {
    const test = await runtime();
    test.monitorCreate.mockResolvedValue(snapshotMonitor("mismatched", "wrong-run"));

    await expect(test.service.bootstrap([vendor])).rejects.toThrow(
      "mismatched Monitor was cancelled automatically",
    );
    expect(test.monitorCancel).toHaveBeenCalledWith("mismatched");
    expect((await test.store.read()).vendors[vendor.domain]?.monitor).toBeUndefined();
  });

  it("refuses to choose between multiple matching orphan Monitors", async () => {
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

  it("replaces a remotely cancelled Monitor without recreating the baseline", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "stale-monitor" });
    test.monitorRetrieve.mockResolvedValue(
      snapshotMonitor("stale-monitor", "run-example.com", "cancelled"),
    );
    const summary = await test.service.bootstrap([vendor]);
    expect(summary).toMatchObject({ baselinesReused: 1, monitorsCreated: 1 });
    expect(test.taskCreate).not.toHaveBeenCalled();
  });

  it("rejects changing the saved baseline identity", async () => {
    const test = await runtime();
    await seedCompletedVendor(test.store, { monitorId: "monitor-1" });
    await expect(
      test.service.bootstrap([{ name: "Renamed", domain: "example.com" }]),
    ).rejects.toThrow("changing its name");
  });

  it("warns that omitted vendors remain active because bootstrap is additive", async () => {
    const test = await runtime();
    const omitted = { name: "Omitted", domain: "omitted.example.com" };
    await seedCompletedVendor(test.store, {
      inputVendor: omitted,
      monitorId: "omitted-monitor",
    });
    const summary = await test.service.bootstrap([vendor]);
    expect(summary.omittedActiveVendors).toEqual([
      { vendor: "omitted.example.com", monitorId: "omitted-monitor" },
    ]);
    expect(summary.warnings[0]).toMatchObject({ code: "omitted_active_vendor" });
  });
});
