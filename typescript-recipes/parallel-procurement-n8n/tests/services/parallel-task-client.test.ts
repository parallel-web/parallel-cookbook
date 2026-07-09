import { describe, it, expect, vi, beforeEach } from "vitest";
import { ParallelTaskClient } from "@/services/parallel-task-client.js";
import {
  ParallelApiError,
  RunNotCompleteError,
} from "@/models/task-api.js";

// ── Mock parallel-web SDK ──────────────────────────────────────────────────

const taskRunMethods = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  result: vi.fn(),
  events: vi.fn(),
}));

const taskGroupMethods = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  addRuns: vi.fn(),
  events: vi.fn(),
  getRuns: vi.fn(),
}));

const constructorSpy = vi.hoisted(() => vi.fn());

const { MockAPIError } = vi.hoisted(() => {
  class MockAPIError extends Error {
    status: number | undefined;
    constructor(message: string, status?: number) {
      super(message);
      this.name = "MockAPIError";
      this.status = status;
    }
  }
  return { MockAPIError };
});

vi.mock("parallel-web", () => {
  return {
    default: class MockParallel {
      taskRun = taskRunMethods;
      taskGroup = taskGroupMethods;
      static APIError = MockAPIError;
      constructor(opts: unknown) {
        constructorSpy(opts);
      }
    },
  };
});

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

function createClient(defaultProcessor: string = "ultra8x") {
  return new ParallelTaskClient({
    apiKey: "test-key",
    baseUrl: "https://api.parallel.ai",
    defaultProcessor,
    logger: silentLogger,
  });
}

const completedRun = {
  run_id: "run_001",
  status: "completed" as const,
  is_active: false,
};

beforeEach(() => {
  for (const m of Object.values(taskRunMethods)) m.mockReset();
  for (const m of Object.values(taskGroupMethods)) m.mockReset();
  constructorSpy.mockReset();
});

// ── createRun ──────────────────────────────────────────────────────────────

describe("createRun", () => {
  it("calls client.taskRun.create with the V1 payload + default processor", async () => {
    taskRunMethods.create.mockResolvedValueOnce({
      run_id: "run_001",
      status: "queued",
    });
    const client = createClient("ultra8x");

    await client.createRun({
      input: "Research Acme Corp",
      outputSchema: {
        type: "json",
        json_schema: { type: "object", properties: {} },
      },
    });

    expect(taskRunMethods.create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "Research Acme Corp",
        processor: "ultra8x",
        task_spec: expect.objectContaining({ output_schema: expect.any(Object) }),
      }),
    );
  });

  it("overrides processor + attaches webhook when provided", async () => {
    taskRunMethods.create.mockResolvedValueOnce({
      run_id: "run_002",
      status: "queued",
    });
    const client = createClient();

    await client.createRun({
      input: "x",
      processor: "core",
      webhook: { url: "https://example.com/cb", events: ["task_run.status"] },
    });

    expect(taskRunMethods.create).toHaveBeenCalledWith(
      expect.objectContaining({
        processor: "core",
        webhook: { url: "https://example.com/cb", event_types: ["task_run.status"] },
      }),
    );
  });

  it("translates SDK APIError into ParallelApiError", async () => {
    taskRunMethods.create.mockRejectedValueOnce(new MockAPIError("bad", 400));
    const client = createClient();

    await expect(client.createRun({ input: "x" })).rejects.toBeInstanceOf(
      ParallelApiError,
    );
  });
});

// ── getRunStatus / getRunResult ────────────────────────────────────────────

describe("getRunStatus", () => {
  it("calls client.taskRun.retrieve", async () => {
    taskRunMethods.retrieve.mockResolvedValueOnce(completedRun);
    const client = createClient();

    const status = await client.getRunStatus("run_001");

    expect(taskRunMethods.retrieve).toHaveBeenCalledWith("run_001");
    expect(status.status).toBe("completed");
  });
});

describe("getRunResult", () => {
  it("fetches the result once status === completed", async () => {
    taskRunMethods.retrieve.mockResolvedValueOnce(completedRun);
    taskRunMethods.result.mockResolvedValueOnce({
      output: {
        type: "json",
        content: { vendor_name: "Acme" },
        basis: [],
      },
    });
    const client = createClient();

    const result = await client.getRunResult("run_001");

    expect(result.output.type).toBe("json");
  });

  it("throws RunNotCompleteError when status is not completed", async () => {
    taskRunMethods.retrieve.mockResolvedValueOnce({
      ...completedRun,
      status: "running",
    });
    const client = createClient();

    await expect(client.getRunResult("run_001")).rejects.toBeInstanceOf(
      RunNotCompleteError,
    );
  });
});

describe("waitForResult", () => {
  it("long-polls client.taskRun.result with timeout", async () => {
    taskRunMethods.result.mockResolvedValueOnce({
      output: { type: "json", content: {}, basis: [] },
    });
    const client = createClient();

    await client.waitForResult("run_001", 300);

    expect(taskRunMethods.result).toHaveBeenCalledWith("run_001", { timeout: 300 });
  });
});

// ── Task Group methods ─────────────────────────────────────────────────────

describe("createTaskGroup", () => {
  it("calls client.taskGroup.create with empty body", async () => {
    taskGroupMethods.create.mockResolvedValueOnce({
      taskgroup_id: "tg_001",
    });
    const client = createClient();

    await client.createTaskGroup();

    expect(taskGroupMethods.create).toHaveBeenCalledWith({});
  });
});

describe("addRunsToGroup", () => {
  it("calls client.taskGroup.addRuns with inputs + default_task_spec", async () => {
    taskGroupMethods.addRuns.mockResolvedValueOnce({
      run_ids: ["r1", "r2"],
    });
    const client = createClient("ultra8x");

    const runIds = await client.addRunsToGroup(
      "tg_001",
      [
        { input: "Research Acme" },
        { input: "Research Foo", processor: "core" },
      ],
      {
        output_schema: {
          type: "json",
          json_schema: { type: "object", properties: {} },
        },
      },
    );

    expect(taskGroupMethods.addRuns).toHaveBeenCalledWith(
      "tg_001",
      expect.objectContaining({
        inputs: [
          { input: "Research Acme", processor: "ultra8x" },
          { input: "Research Foo", processor: "core" },
        ],
        default_task_spec: expect.any(Object),
      }),
    );
    expect(runIds).toEqual(["r1", "r2"]);
  });
});

describe("getTaskGroupStatus", () => {
  it("calls client.taskGroup.retrieve", async () => {
    taskGroupMethods.retrieve.mockResolvedValueOnce({
      taskgroup_id: "tg_001",
      status: {
        is_active: false,
        num_task_runs: 1,
        task_run_status_counts: { completed: 1 },
      },
    });
    const client = createClient();

    const status = await client.getTaskGroupStatus("tg_001");

    expect(status.status.is_active).toBe(false);
    expect(taskGroupMethods.retrieve).toHaveBeenCalledWith("tg_001");
  });
});

describe("getTaskGroupResults", () => {
  it("drains the streaming getRuns endpoint into an array", async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "task_run.state",
          run: { run_id: "r1", status: "completed" },
          output: { type: "json", content: { ok: true }, basis: [] },
        };
        yield {
          type: "task_run.state",
          run: { run_id: "r2", status: "failed" },
        };
      },
    };
    taskGroupMethods.getRuns.mockResolvedValueOnce(stream);
    const client = createClient();

    const runs = await client.getTaskGroupResults("tg_001", true);

    expect(taskGroupMethods.getRuns).toHaveBeenCalledWith("tg_001", {
      include_output: true,
    });
    expect(runs).toHaveLength(2);
    expect(runs[0].run_id).toBe("r1");
    expect(runs[0].output?.type).toBe("json");
    expect(runs[1].run_id).toBe("r2");
  });
});

describe("pollTaskGroupUntilComplete", () => {
  it("returns getRuns output once is_active flips false", async () => {
    taskGroupMethods.retrieve.mockResolvedValueOnce({
      taskgroup_id: "tg_001",
      status: { is_active: false, num_task_runs: 1, task_run_status_counts: {} },
    });
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "task_run.state",
          run: { run_id: "r1", status: "completed" },
          output: { type: "json", content: {}, basis: [] },
        };
      },
    };
    taskGroupMethods.getRuns.mockResolvedValueOnce(stream);
    const client = createClient();

    const runs = await client.pollTaskGroupUntilComplete("tg_001", 10, 1000);

    expect(runs).toHaveLength(1);
  });
});
