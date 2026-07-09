import { describe, expect, it } from "vitest";

import { TaskRunner } from "../src/task-runner.js";
import { fixedNow, fakeClient } from "./runtime.js";
import { reportResult, taskRun, vendorReport } from "./fixtures.js";

function runner(
  fake: ReturnType<typeof fakeClient>,
  options: { clock?: () => number; sleep?: (milliseconds: number) => Promise<void> } = {},
) {
  return new TaskRunner({
    client: fake.client,
    pollSeconds: 1,
    maxWaitMilliseconds: 10,
    retryDelayMilliseconds: 5,
    now: () => fixedNow,
    sleep: options.sleep ?? (async () => {}),
    clock: options.clock,
  });
}

describe("TaskRunner", () => {
  it.each(["failed", "cancelled", "action_required"] as const)(
    "classifies a resolved %s result as a remote terminal failure",
    async (status) => {
      const fake = fakeClient();
      const terminalRun = {
        ...taskRun("terminal-run"),
        status,
        error: { message: `${status} message`, ref_id: "ref-1" },
      };
      fake.taskResult.mockResolvedValue({
        ...reportResult(vendorReport(), "terminal-run"),
        run: terminalRun,
      });
      const tasks = runner(fake);

      let caught: unknown;
      try {
        await tasks.wait("terminal-run");
      } catch (error) {
        caught = error;
      }
      expect(tasks.failure(caught, {
        runId: "terminal-run",
        startedAt: fixedNow.toISOString(),
      })).toMatchObject({
        kind: "remote_terminal",
        status,
        message: `${status} message`,
        refId: "ref-1",
      });
      expect(fake.taskRetrieve).not.toHaveBeenCalled();
    },
  );

  it("uses the injected clock to stop polling at the configured deadline", async () => {
    const fake = fakeClient();
    fake.taskResult.mockRejectedValue({ status: 408, message: "still running" });
    fake.taskRetrieve.mockResolvedValue({ ...taskRun("slow-run"), status: "running" });
    let time = 0;
    const tasks = runner(fake, {
      clock: () => time,
      sleep: async (milliseconds) => {
        time += milliseconds;
      },
    });

    await expect(tasks.wait("slow-run")).rejects.toThrow("did not complete within 10ms");
    expect(fake.taskResult).toHaveBeenCalledTimes(2);
  });
});
