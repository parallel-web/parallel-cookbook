import { describe, expect, it } from "vitest";

import { runLiveContract } from "../scripts/live-contract.js";

const liveTest = process.env.RUN_LIVE_TESTS === "1" ? it : it.skip;

describe("live Task to snapshot Monitor contract", () => {
  liveTest(
    "creates a structured baseline and confirms disposable Monitor cancellation",
    async () => {
      const apiKey = process.env.PARALLEL_API_KEY;
      if (!apiKey) throw new Error("PARALLEL_API_KEY is required for the live test.");

      const summary = await runLiveContract({ apiKey });
      expect(summary.taskRunId).toBeTruthy();
      expect(summary.monitorId).toBeTruthy();
      expect(summary.basisEntries).toBeGreaterThan(0);
      expect(summary.eventCount).toBeGreaterThanOrEqual(0);
      expect(summary.cancelled).toBe(true);
    },
    12 * 60 * 1_000,
  );
});
