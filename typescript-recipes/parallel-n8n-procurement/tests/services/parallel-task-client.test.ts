import { describe, it, expect, vi, beforeEach } from "vitest";
import axios, { AxiosError, type AxiosHeaders } from "axios";
import { ParallelTaskClient } from "@/services/parallel-task-client.js";
import {
  ParallelApiError,
  RunNotCompleteError,
  TaskGroupTimeoutError,
} from "@/models/task-api.js";

// ── Mock Setup ─────────────────────────────────────────────────────────────

const mockRequest = vi.fn();

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({
      request: mockRequest,
    })),
  },
  AxiosError: class MockAxiosError extends Error {
    response: unknown;
    isAxiosError = true;
    constructor(message: string, _code?: string, _config?: unknown, _request?: unknown, response?: unknown) {
      super(message);
      this.response = response;
    }
  },
}));

const silentLogger = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createClient() {
  return new ParallelTaskClient({
    apiKey: "test-key",
    baseUrl: "https://api.parallel.ai",
    logger: silentLogger,
  });
}

function mockResponse<T>(data: T, status = 200) {
  return { data, status, statusText: "OK", headers: {}, config: {} };
}

function makeAxiosError(status: number, body: unknown = "", headers: Record<string, string> = {}) {
  const err = new AxiosError(
    `Request failed with status ${status}`,
    String(status),
    undefined,
    undefined,
    { data: body, status, statusText: "", headers, config: {} as never } as never,
  );
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ── Constructor ────────────────────────────────────────────────────────────

describe("ParallelTaskClient constructor", () => {
  it("creates an axios instance with correct config", () => {
    createClient();
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://api.parallel.ai",
        headers: expect.objectContaining({
          "x-api-key": "test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});

// ── createRun ──────────────────────────────────────────────────────────────

describe("createRun", () => {
  it("sends POST with correct body and default processor", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ run_id: "run_1", status: "queued" }),
    );

    const result = await client.createRun({ input: "Research Acme Corp" });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/v1/tasks/runs",
        data: expect.objectContaining({
          input: "Research Acme Corp",
          processor: "ultra8x",
        }),
      }),
    );
    expect(result.run_id).toBe("run_1");
    expect(result.status).toBe("queued");
  });

  it("uses custom processor when provided", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ run_id: "run_1", status: "queued" }),
    );

    await client.createRun({ input: "test", processor: "base-fast" });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processor: "base-fast" }),
      }),
    );
  });

  it("includes output_schema in task_spec when provided", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ run_id: "run_1", status: "queued" }),
    );

    await client.createRun({
      input: "test",
      outputSchema: {
        type: "json",
        json_schema: { properties: { score: { type: "number" } } },
      },
    });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          task_spec: {
            output_schema: {
              type: "json",
              json_schema: { properties: { score: { type: "number" } } },
            },
          },
        }),
      }),
    );
  });

  it("includes webhook when provided", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ run_id: "run_1", status: "queued" }),
    );

    await client.createRun({
      input: "test",
      webhook: { url: "https://example.com/hook", events: ["task_run.status"] },
    });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          webhook: { url: "https://example.com/hook", events: ["task_run.status"] },
        }),
      }),
    );
  });

  it("throws ParallelApiError on 400 response", async () => {
    const client = createClient();
    mockRequest.mockRejectedValueOnce(makeAxiosError(400, "Bad request"));

    await expect(client.createRun({ input: "test" })).rejects.toThrow(
      ParallelApiError,
    );
  });
});

// ── getRunStatus ───────────────────────────────────────────────────────────

describe("getRunStatus", () => {
  it("sends GET to correct endpoint", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ run_id: "run_1", status: "running", is_active: true }),
    );

    const result = await client.getRunStatus("run_1");

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/v1/tasks/runs/run_1",
      }),
    );
    expect(result.status).toBe("running");
  });
});

// ── getRunResult ───────────────────────────────────────────────────────────

describe("getRunResult", () => {
  it("returns result when run is completed", async () => {
    const client = createClient();
    // First call: getRunStatus
    mockRequest.mockResolvedValueOnce(
      mockResponse({ run_id: "run_1", status: "completed" }),
    );
    // Second call: get result
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        output: { type: "json", content: { risk: "HIGH" } },
      }),
    );

    const result = await client.getRunResult("run_1");

    expect(result.output.type).toBe("json");
    expect(result.output.content).toEqual({ risk: "HIGH" });
  });

  it("throws RunNotCompleteError when run is still running", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ run_id: "run_1", status: "running" }),
    );

    await expect(client.getRunResult("run_1")).rejects.toThrow(
      RunNotCompleteError,
    );
  });

  it("throws RunNotCompleteError when run is queued", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ run_id: "run_1", status: "queued" }),
    );

    const err = await client.getRunResult("run_1").catch((e: Error) => e);
    expect(err).toBeInstanceOf(RunNotCompleteError);
    expect((err as RunNotCompleteError).runId).toBe("run_1");
    expect((err as RunNotCompleteError).currentStatus).toBe("queued");
  });

  it("returns output with basis when available", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ run_id: "run_1", status: "completed" }),
    );
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        output: {
          type: "json",
          content: { score: 85 },
          basis: [
            {
              field: "score",
              reasoning: "Financial analysis",
              citations: [{ url: "https://example.com" }],
              confidence: "high",
            },
          ],
        },
      }),
    );

    const result = await client.getRunResult("run_1");
    expect(result.output.basis).toHaveLength(1);
    expect(result.output.basis![0].field).toBe("score");
  });
});

// ── createTaskGroup ────────────────────────────────────────────────────────

describe("createTaskGroup", () => {
  it("sends POST and returns taskgroup_id", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ taskgroup_id: "tg_abc" }),
    );

    const result = await client.createTaskGroup();

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/v1beta/tasks/groups",
        data: {},
      }),
    );
    expect(result.taskgroup_id).toBe("tg_abc");
  });
});

// ── addRunsToGroup ─────────────────────────────────────────────────────────

describe("addRunsToGroup", () => {
  it("sends all runs in single request when under 1000", async () => {
    const client = createClient();
    const runs = Array.from({ length: 5 }, (_, i) => ({
      input: `vendor_${i}`,
    }));
    mockRequest.mockResolvedValueOnce(
      mockResponse({ run_ids: ["r1", "r2", "r3", "r4", "r5"] }),
    );

    const ids = await client.addRunsToGroup("tg_1", runs);

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(ids).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });

  it("chunks runs into batches of 1000", async () => {
    const client = createClient();
    const runs = Array.from({ length: 2500 }, (_, i) => ({
      input: `vendor_${i}`,
    }));

    // 3 batches: 1000, 1000, 500
    mockRequest
      .mockResolvedValueOnce(
        mockResponse({ run_ids: Array.from({ length: 1000 }, (_, i) => `r_${i}`) }),
      )
      .mockResolvedValueOnce(
        mockResponse({ run_ids: Array.from({ length: 1000 }, (_, i) => `r_${1000 + i}`) }),
      )
      .mockResolvedValueOnce(
        mockResponse({ run_ids: Array.from({ length: 500 }, (_, i) => `r_${2000 + i}`) }),
      );

    const ids = await client.addRunsToGroup("tg_1", runs);

    expect(mockRequest).toHaveBeenCalledTimes(3);
    expect(ids).toHaveLength(2500);

    // Verify chunk sizes
    const firstCallData = mockRequest.mock.calls[0][0].data;
    const secondCallData = mockRequest.mock.calls[1][0].data;
    const thirdCallData = mockRequest.mock.calls[2][0].data;
    expect(firstCallData.inputs).toHaveLength(1000);
    expect(secondCallData.inputs).toHaveLength(1000);
    expect(thirdCallData.inputs).toHaveLength(500);
  });

  it("passes default_task_spec when provided", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(mockResponse({ run_ids: ["r1"] }));

    await client.addRunsToGroup(
      "tg_1",
      [{ input: "test" }],
      { output_schema: { type: "json", json_schema: { properties: {} } } },
    );

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          default_task_spec: {
            output_schema: { type: "json", json_schema: { properties: {} } },
          },
        }),
      }),
    );
  });
});

// ── getTaskGroupStatus ─────────────────────────────────────────────────────

describe("getTaskGroupStatus", () => {
  it("returns parsed status", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        taskgroup_id: "tg_1",
        status: {
          is_active: true,
          num_task_runs: 10,
          task_run_status_counts: { completed: 3, running: 7 },
        },
      }),
    );

    const result = await client.getTaskGroupStatus("tg_1");

    expect(result.status.is_active).toBe(true);
    expect(result.status.num_task_runs).toBe(10);
    expect(result.status.task_run_status_counts.completed).toBe(3);
  });
});

// ── getTaskGroupResults ────────────────────────────────────────────────────

describe("getTaskGroupResults", () => {
  it("sends GET with include_output=true by default", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse([
        { run_id: "r1", status: "completed", output: { type: "text", content: "done" } },
      ]),
    );

    await client.getTaskGroupResults("tg_1");

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { include_output: true },
      }),
    );
  });

  it("sends GET with include_output=false when specified", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(mockResponse([{ run_id: "r1", status: "completed" }]));

    await client.getTaskGroupResults("tg_1", false);

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { include_output: false },
      }),
    );
  });

  it("parses run results correctly", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse([
        { run_id: "r1", status: "completed", output: { type: "json", content: { a: 1 } } },
        { run_id: "r2", status: "failed", error: "timeout" },
      ]),
    );

    const results = await client.getTaskGroupResults("tg_1");

    expect(results).toHaveLength(2);
    expect(results[0].run_id).toBe("r1");
    expect(results[1].status).toBe("failed");
  });
});

// ── pollTaskGroupUntilComplete ─────────────────────────────────────────────

describe("pollTaskGroupUntilComplete", () => {
  it("polls until is_active becomes false then returns results", async () => {
    vi.useFakeTimers();
    const client = createClient();

    // 3 status polls: active, active, done
    mockRequest
      .mockResolvedValueOnce(
        mockResponse({
          taskgroup_id: "tg_1",
          status: { is_active: true, num_task_runs: 2, task_run_status_counts: { running: 2 } },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          taskgroup_id: "tg_1",
          status: { is_active: true, num_task_runs: 2, task_run_status_counts: { running: 1, completed: 1 } },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          taskgroup_id: "tg_1",
          status: { is_active: false, num_task_runs: 2, task_run_status_counts: { completed: 2 } },
        }),
      )
      // Final getTaskGroupResults call
      .mockResolvedValueOnce(
        mockResponse([
          { run_id: "r1", status: "completed", output: { type: "text", content: "a" } },
          { run_id: "r2", status: "completed", output: { type: "text", content: "b" } },
        ]),
      );

    const promise = client.pollTaskGroupUntilComplete("tg_1", 1000, 60000);

    // Advance through the two sleep intervals
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const results = await promise;

    expect(results).toHaveLength(2);
    // 3 status calls + 1 results call
    expect(mockRequest).toHaveBeenCalledTimes(4);
  });

  it("throws TaskGroupTimeoutError when timeout exceeded", async () => {
    vi.useFakeTimers();
    const client = createClient();

    // Always active
    mockRequest.mockResolvedValue(
      mockResponse({
        taskgroup_id: "tg_1",
        status: { is_active: true, num_task_runs: 1, task_run_status_counts: { running: 1 } },
      }),
    );

    const promise = client.pollTaskGroupUntilComplete("tg_1", 500, 1500);
    // Attach catch handler immediately to prevent unhandled rejection
    const errorPromise = promise.catch((e: Error) => e);

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);

    const err = await errorPromise;
    expect(err).toBeInstanceOf(TaskGroupTimeoutError);
  });
});

// ── Retry Logic ────────────────────────────────────────────────────────────

describe("retry logic", () => {
  it("retries on 429 and succeeds on second attempt", async () => {
    vi.useFakeTimers();
    const client = createClient();

    mockRequest
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce(mockResponse({ run_id: "run_1", status: "queued" }));

    const promise = client.createRun({ input: "test" });

    // Advance past retry delay (1s for first retry)
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.run_id).toBe("run_1");
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("retries on 500, 502, 503", async () => {
    vi.useFakeTimers();
    const client = createClient();

    mockRequest
      .mockRejectedValueOnce(makeAxiosError(500))
      .mockRejectedValueOnce(makeAxiosError(502))
      .mockRejectedValueOnce(makeAxiosError(503))
      .mockResolvedValueOnce(mockResponse({ run_id: "run_1", status: "queued" }));

    const promise = client.createRun({ input: "test" });

    await vi.advanceTimersByTimeAsync(1000); // retry 1
    await vi.advanceTimersByTimeAsync(2000); // retry 2
    await vi.advanceTimersByTimeAsync(4000); // retry 3

    const result = await promise;
    expect(result.run_id).toBe("run_1");
    expect(mockRequest).toHaveBeenCalledTimes(4);
  });

  it("does not retry on 400", async () => {
    const client = createClient();
    mockRequest.mockRejectedValueOnce(makeAxiosError(400, "Bad request"));

    await expect(client.createRun({ input: "test" })).rejects.toThrow(
      ParallelApiError,
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("does not retry on 401", async () => {
    const client = createClient();
    mockRequest.mockRejectedValueOnce(makeAxiosError(401, "Unauthorized"));

    await expect(client.createRun({ input: "test" })).rejects.toThrow(
      ParallelApiError,
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("does not retry on 404", async () => {
    const client = createClient();
    mockRequest.mockRejectedValueOnce(makeAxiosError(404, "Not found"));

    await expect(client.createRun({ input: "test" })).rejects.toThrow(
      ParallelApiError,
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("throws ParallelApiError after max retries exhausted", async () => {
    vi.useFakeTimers();
    const client = createClient();

    mockRequest
      .mockRejectedValueOnce(makeAxiosError(500))
      .mockRejectedValueOnce(makeAxiosError(500))
      .mockRejectedValueOnce(makeAxiosError(500))
      .mockRejectedValueOnce(makeAxiosError(500)); // 4th = exhausted (0 + 3 retries)

    const promise = client.createRun({ input: "test" });
    // Attach catch handler immediately to prevent unhandled rejection
    const errorPromise = promise.catch((e: Error) => e);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);

    const err = await errorPromise;
    expect(err).toBeInstanceOf(ParallelApiError);
    expect((err as ParallelApiError).status).toBe(500);
    expect(mockRequest).toHaveBeenCalledTimes(4);
  });

  it("uses exponential backoff delays", async () => {
    vi.useFakeTimers();
    const client = createClient();

    mockRequest
      .mockRejectedValueOnce(makeAxiosError(500))
      .mockRejectedValueOnce(makeAxiosError(500))
      .mockRejectedValueOnce(makeAxiosError(500))
      .mockResolvedValueOnce(mockResponse({ run_id: "run_1", status: "queued" }));

    const promise = client.createRun({ input: "test" });

    // After 999ms, still on first retry wait
    await vi.advanceTimersByTimeAsync(999);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    // At 1000ms, first retry fires
    await vi.advanceTimersByTimeAsync(1);
    expect(mockRequest).toHaveBeenCalledTimes(2);

    // Second retry at 2000ms additional
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockRequest).toHaveBeenCalledTimes(3);

    // Third retry at 4000ms additional
    await vi.advanceTimersByTimeAsync(4000);
    expect(mockRequest).toHaveBeenCalledTimes(4);

    await promise;
  });

  it("respects Retry-After header on 429", async () => {
    vi.useFakeTimers();
    const client = createClient();

    mockRequest
      .mockRejectedValueOnce(makeAxiosError(429, "", { "retry-after": "5" }))
      .mockResolvedValueOnce(mockResponse({ run_id: "run_1", status: "queued" }));

    const promise = client.createRun({ input: "test" });

    // Normal backoff would be 1s, but Retry-After says 5s
    await vi.advanceTimersByTimeAsync(4999);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockRequest).toHaveBeenCalledTimes(2);

    await promise;
  });
});
