import { describe, it, expect } from "vitest";
import {
  TaskRunSchema,
  TaskRunResultSchema,
  TaskRunInputSchema,
  TaskGroupSchema,
  TaskGroupStatusSchema,
  TaskGroupRunSchema,
  TaskGroupResultsSchema,
  WebhookConfigSchema,
  ParallelApiError,
  RunNotCompleteError,
  TaskGroupTimeoutError,
} from "@/models/task-api.js";

// ── Error Classes ──────────────────────────────────────────────────────────

describe("ParallelApiError", () => {
  it("has correct name, status, and message", () => {
    const err = new ParallelApiError("Bad request", 400, '{"detail":"invalid"}');
    expect(err.name).toBe("ParallelApiError");
    expect(err.status).toBe(400);
    expect(err.message).toBe("Bad request");
    expect(err.responseBody).toBe('{"detail":"invalid"}');
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults responseBody to empty string", () => {
    const err = new ParallelApiError("Server error", 500);
    expect(err.responseBody).toBe("");
  });
});

describe("RunNotCompleteError", () => {
  it("has correct name, runId, and currentStatus", () => {
    const err = new RunNotCompleteError("run_123", "running");
    expect(err.name).toBe("RunNotCompleteError");
    expect(err.runId).toBe("run_123");
    expect(err.currentStatus).toBe("running");
    expect(err.message).toContain("run_123");
    expect(err.message).toContain("running");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("TaskGroupTimeoutError", () => {
  it("has correct name, taskGroupId, and elapsedMs", () => {
    const err = new TaskGroupTimeoutError("tg_456", 120000);
    expect(err.name).toBe("TaskGroupTimeoutError");
    expect(err.taskGroupId).toBe("tg_456");
    expect(err.elapsedMs).toBe(120000);
    expect(err.message).toContain("tg_456");
    expect(err.message).toContain("120s");
    expect(err).toBeInstanceOf(Error);
  });
});

// ── Zod Schemas ────────────────────────────────────────────────────────────

describe("TaskRunSchema", () => {
  it("accepts a valid task run", () => {
    const result = TaskRunSchema.safeParse({
      run_id: "run_abc",
      status: "queued",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a task run with optional fields", () => {
    const result = TaskRunSchema.safeParse({
      run_id: "run_abc",
      status: "failed",
      is_active: false,
      error: "Something went wrong",
    });
    expect(result.success).toBe(true);
  });

  it("passes through extra fields from API", () => {
    const result = TaskRunSchema.parse({
      run_id: "run_abc",
      status: "completed",
      some_future_field: true,
    });
    expect((result as Record<string, unknown>).some_future_field).toBe(true);
  });

  it("rejects missing run_id", () => {
    const result = TaskRunSchema.safeParse({ status: "queued" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = TaskRunSchema.safeParse({
      run_id: "run_abc",
      status: "unknown",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid statuses", () => {
    for (const status of ["queued", "running", "completed", "failed", "cancelled"]) {
      expect(
        TaskRunSchema.safeParse({ run_id: "r", status }).success
      ).toBe(true);
    }
  });
});

describe("TaskRunResultSchema", () => {
  it("accepts a text output", () => {
    const result = TaskRunResultSchema.safeParse({
      output: { type: "text", content: "Some research result" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a json output", () => {
    const result = TaskRunResultSchema.safeParse({
      output: {
        type: "json",
        content: { risk_score: "HIGH", summary: "Risky vendor" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts output with basis", () => {
    const result = TaskRunResultSchema.safeParse({
      output: {
        type: "json",
        content: { score: 85 },
        basis: [
          {
            field: "score",
            reasoning: "Based on financial data",
            citations: [{ url: "https://example.com", title: "Source" }],
            confidence: "high",
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing output", () => {
    const result = TaskRunResultSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("TaskRunInputSchema", () => {
  it("accepts string input", () => {
    const result = TaskRunInputSchema.safeParse({ input: "Research Acme Corp" });
    expect(result.success).toBe(true);
  });

  it("accepts object input", () => {
    const result = TaskRunInputSchema.safeParse({
      input: { entity_name: "Acme", website: "https://acme.com" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts input with processor", () => {
    const result = TaskRunInputSchema.safeParse({
      input: "Research Acme",
      processor: "base-fast",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processor).toBe("base-fast");
    }
  });

  it("processor is optional", () => {
    const result = TaskRunInputSchema.parse({ input: "test" });
    expect(result.processor).toBeUndefined();
  });
});

describe("TaskGroupSchema", () => {
  it("accepts a valid task group", () => {
    const result = TaskGroupSchema.safeParse({ taskgroup_id: "tg_abc" });
    expect(result.success).toBe(true);
  });

  it("rejects missing taskgroup_id", () => {
    const result = TaskGroupSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("TaskGroupStatusSchema", () => {
  it("accepts a valid status", () => {
    const result = TaskGroupStatusSchema.safeParse({
      taskgroup_id: "tg_abc",
      status: {
        is_active: true,
        num_task_runs: 10,
        task_run_status_counts: { queued: 5, running: 3, completed: 2 },
      },
    });
    expect(result.success).toBe(true);
  });

  it("defaults task_run_status_counts to empty object", () => {
    const result = TaskGroupStatusSchema.parse({
      taskgroup_id: "tg_abc",
      status: { is_active: false, num_task_runs: 0 },
    });
    expect(result.status.task_run_status_counts).toEqual({});
  });

  it("rejects missing is_active", () => {
    const result = TaskGroupStatusSchema.safeParse({
      taskgroup_id: "tg_abc",
      status: { num_task_runs: 0, task_run_status_counts: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe("TaskGroupResultsSchema", () => {
  it("accepts an array of runs", () => {
    const result = TaskGroupResultsSchema.safeParse([
      { run_id: "r1", status: "completed", output: { type: "text", content: "done" } },
      { run_id: "r2", status: "failed", error: "timeout" },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts an empty array", () => {
    const result = TaskGroupResultsSchema.safeParse([]);
    expect(result.success).toBe(true);
  });
});

describe("WebhookConfigSchema", () => {
  it("accepts a valid webhook config", () => {
    const result = WebhookConfigSchema.safeParse({
      url: "https://example.com/webhook",
      events: ["task_run.status", "task_run.completed"],
    });
    expect(result.success).toBe(true);
  });

  it("defaults events to ['task_run.status']", () => {
    const result = WebhookConfigSchema.parse({
      url: "https://example.com/webhook",
    });
    expect(result.events).toEqual(["task_run.status"]);
  });

  it("rejects invalid URL", () => {
    const result = WebhookConfigSchema.safeParse({
      url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});
