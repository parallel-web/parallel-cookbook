import Parallel from "parallel-web";
import type {
  Monitor as SdkMonitor,
  MonitorCompletionEvent as SdkMonitorCompletionEvent,
  MonitorErrorEvent as SdkMonitorErrorEvent,
  MonitorEventStreamEvent as SdkMonitorEventStreamEvent,
  MonitorSnapshotEvent as SdkMonitorSnapshotEvent,
  PaginatedMonitorEvents as SdkPaginatedMonitorEvents,
  PaginatedMonitorResponse as SdkPaginatedMonitorResponse,
} from "parallel-web/resources/monitor";
import type {
  TaskRun as SdkTaskRun,
  TaskRunJsonOutput as SdkTaskRunJsonOutput,
  TaskRunResult as SdkTaskRunResult,
  TaskRunTextOutput as SdkTaskRunTextOutput,
} from "parallel-web/resources/task-run";
import { describe, expect, it, vi } from "vitest";

import type {
  EventStreamMonitor,
  MonitorCreateParams,
  MonitorEventsParams,
  MonitorListParams,
  RequestOptions,
  SnapshotMonitor,
  TaskRunCreateParams,
  TaskRunJsonOutput,
  TaskRunResultParams,
  TaskRunTextOutput,
} from "../src/parallel-port.js";
import { createParallelPort } from "../src/parallel-sdk-adapter.js";

const CREATED_AT = "2026-07-09T12:00:00.000Z";

function sdkTaskRun(
  runId: string,
  status: SdkTaskRun["status"],
): SdkTaskRun {
  return Object.assign(new Parallel({ apiKey: "fixture-api-key" }).taskRun, {
    created_at: CREATED_AT,
    interaction_id: `interaction-${runId}`,
    is_active: status === "queued" || status === "running" || status === "cancelling",
    modified_at: CREATED_AT,
    processor: "base",
    run_id: runId,
    status,
  });
}

function sdkJsonOutput(): SdkTaskRunJsonOutput {
  return {
    type: "json",
    content: { risk_level: "high" },
    basis: [
      {
        field: "risk_level",
        reasoning: "A regulator published an enforcement action.",
        confidence: "high",
        citations: [
          {
            url: "https://regulator.example/enforcement",
            title: "Enforcement action",
            excerpts: ["The action became effective today."],
          },
          {
            url: "https://vendor.example/update",
            title: null,
            excerpts: null,
          },
        ],
      },
    ],
  };
}

function sdkTextOutput(): SdkTaskRunTextOutput {
  return {
    type: "text",
    content: "A new material event was detected.",
    basis: [
      {
        field: "output",
        reasoning: "The announcement is new.",
        citations: [{ url: "https://vendor.example/announcement" }],
      },
    ],
  };
}

function sdkSnapshotMonitor(
  monitorId = "monitor-snapshot",
  status: SdkMonitor["status"] = "active",
): SdkMonitor {
  return {
    created_at: CREATED_AT,
    frequency: "1d",
    monitor_id: monitorId,
    processor: "lite",
    settings: {
      task_run_id: "run-baseline",
      query: "Track material vendor-risk changes.",
    },
    status,
    type: "snapshot",
    metadata: { recipe: "vendor-intel" },
  };
}

function sdkEventStreamMonitor(
  monitorId = "monitor-stream",
  status: SdkMonitor["status"] = "active",
): SdkMonitor {
  return {
    created_at: CREATED_AT,
    frequency: "2d",
    monitor_id: monitorId,
    processor: "base",
    settings: { query: "Track vendor announcements." },
    status,
    type: "event_stream",
    metadata: null,
  };
}

const mappedJsonOutput = {
  type: "json",
  content: { risk_level: "high" },
  basis: [
    {
      field: "risk_level",
      reasoning: "A regulator published an enforcement action.",
      confidence: "high",
      citations: [
        {
          url: "https://regulator.example/enforcement",
          title: "Enforcement action",
          excerpts: ["The action became effective today."],
        },
        {
          url: "https://vendor.example/update",
          title: null,
          excerpts: null,
        },
      ],
    },
  ],
} satisfies TaskRunJsonOutput;

const mappedTextOutput = {
  type: "text",
  content: "A new material event was detected.",
  basis: [
    {
      field: "output",
      reasoning: "The announcement is new.",
      citations: [{ url: "https://vendor.example/announcement" }],
    },
  ],
} satisfies TaskRunTextOutput;

function mappedSnapshotMonitor(
  status: SnapshotMonitor["status"] = "active",
): SnapshotMonitor {
  return {
    monitor_id: "monitor-snapshot",
    status,
    processor: "lite",
    frequency: "1d",
    created_at: CREATED_AT,
    metadata: { recipe: "vendor-intel" },
    type: "snapshot",
    settings: {
      task_run_id: "run-baseline",
      query: "Track material vendor-risk changes.",
    },
  };
}

const mappedEventStreamMonitor = {
  monitor_id: "monitor-stream",
  status: "active",
  processor: "base",
  frequency: "2d",
  created_at: CREATED_AT,
  type: "event_stream",
  settings: { query: "Track vendor announcements." },
} satisfies EventStreamMonitor;

describe("createParallelPort", () => {
  it("forwards Task requests and maps runs, errors, warnings, and field basis", async () => {
    const client = new Parallel({ apiKey: "test-api-key" });
    const createdRun = Object.assign(sdkTaskRun("run-created", "failed"), {
      error: { message: "The Task could not complete.", ref_id: "error-ref" },
      warnings: [
        {
          message: "One requested field was ambiguous.",
          type: "spec_validation_warning" as const,
        },
      ],
    }) satisfies SdkTaskRun;
    const retrievedRun = sdkTaskRun("run-retrieved", "running");
    const result = {
      run: sdkTaskRun("run-result", "completed"),
      output: sdkJsonOutput(),
    } satisfies SdkTaskRunResult;
    const create = vi.spyOn(client.taskRun, "create").mockResolvedValue(createdRun);
    const retrieve = vi
      .spyOn(client.taskRun, "retrieve")
      .mockResolvedValue(retrievedRun);
    const taskResult = vi.spyOn(client.taskRun, "result").mockResolvedValue(result);
    const port = createParallelPort(client);
    const createParams = {
      input: { vendor: "Example", domain: "example.com" },
      processor: "base",
      task_spec: {
        output_schema: {
          type: "json",
          json_schema: { type: "object" },
        },
      },
      metadata: { recipe: "vendor-intel", attempt: 1 },
      previous_interaction_id: "interaction-prior",
    } satisfies TaskRunCreateParams;
    const resultParams = { timeout: 60 } satisfies TaskRunResultParams;
    const requestOptions = {
      maxRetries: 1,
      timeout: 5_000,
    } satisfies RequestOptions;
    const createOptions = { maxRetries: 0 } satisfies RequestOptions;

    await expect(port.taskRun.create(createParams, createOptions)).resolves.toEqual({
      run_id: "run-created",
      interaction_id: "interaction-run-created",
      status: "failed",
      error: {
        message: "The Task could not complete.",
        ref_id: "error-ref",
      },
      warnings: [{ message: "One requested field was ambiguous." }],
    });
    await expect(port.taskRun.retrieve("run-retrieved")).resolves.toEqual({
      run_id: "run-retrieved",
      interaction_id: "interaction-run-retrieved",
      status: "running",
    });
    await expect(
      port.taskRun.result("run-result", resultParams, requestOptions),
    ).resolves.toEqual({
      run: {
        run_id: "run-result",
        interaction_id: "interaction-run-result",
        status: "completed",
      },
      output: mappedJsonOutput,
    });

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(createParams, createOptions);
    expect(retrieve).toHaveBeenCalledOnce();
    expect(retrieve).toHaveBeenCalledWith("run-retrieved");
    expect(taskResult).toHaveBeenCalledOnce();
    expect(taskResult).toHaveBeenCalledWith(
      "run-result",
      resultParams,
      requestOptions,
    );
  });

  it("forwards Monitor requests and maps monitors, every event variant, and pagination", async () => {
    const client = new Parallel({ apiKey: "test-api-key" });
    const snapshot = sdkSnapshotMonitor();
    const stream = sdkEventStreamMonitor();
    const cancelled = sdkSnapshotMonitor("monitor-snapshot", "cancelled");
    const monitorPage = {
      monitors: [snapshot, stream],
      next_cursor: "monitor-cursor",
    } satisfies SdkPaginatedMonitorResponse;
    const snapshotEvent = {
      event_id: "event-snapshot",
      event_group_id: "group-snapshot",
      event_date: "2026-07-09",
      previous_output: sdkJsonOutput(),
      changed_output: sdkTextOutput(),
      event_type: "snapshot",
    } satisfies SdkMonitorSnapshotEvent;
    const streamEvent = {
      event_id: "event-stream",
      event_group_id: "group-stream",
      event_date: null,
      output: sdkTextOutput(),
      event_type: "event_stream",
    } satisfies SdkMonitorEventStreamEvent;
    const errorEvent = {
      error_message: "The scheduled execution exceeded quota.",
      timestamp: "2026-07-09T13:00:00.000Z",
      event_type: "error",
    } satisfies SdkMonitorErrorEvent;
    const completionEvent = {
      timestamp: "2026-07-09T14:00:00.000Z",
      event_type: "completion",
    } satisfies SdkMonitorCompletionEvent;
    const eventPage = {
      events: [snapshotEvent, streamEvent, errorEvent, completionEvent],
      next_cursor: "event-cursor",
      warnings: [{ message: "Results were truncated.", type: "warning" }],
    } satisfies SdkPaginatedMonitorEvents;
    const create = vi.spyOn(client.monitor, "create").mockResolvedValue(snapshot);
    const retrieve = vi.spyOn(client.monitor, "retrieve").mockResolvedValue(stream);
    const list = vi.spyOn(client.monitor, "list").mockResolvedValue(monitorPage);
    const events = vi.spyOn(client.monitor, "events").mockResolvedValue(eventPage);
    const cancel = vi.spyOn(client.monitor, "cancel").mockResolvedValue(cancelled);
    const port = createParallelPort(client);
    const createParams = {
      type: "snapshot",
      frequency: "1d",
      processor: "lite",
      settings: { task_run_id: "run-baseline" },
      metadata: { recipe: "vendor-intel" },
    } satisfies MonitorCreateParams;
    const listParams = {
      cursor: "monitor-before",
      limit: 20,
      status: ["active", "cancelled"],
      type: ["snapshot", "event_stream"],
    } satisfies MonitorListParams;
    const eventParams = {
      cursor: "event-before",
      event_group_id: "group-filter",
      include_completions: true,
      limit: 50,
    } satisfies MonitorEventsParams;
    const createOptions = { maxRetries: 0 } satisfies RequestOptions;

    await expect(port.monitor.create(createParams, createOptions)).resolves.toEqual(
      mappedSnapshotMonitor(),
    );
    await expect(port.monitor.retrieve("monitor-stream")).resolves.toEqual(
      mappedEventStreamMonitor,
    );
    await expect(port.monitor.list(listParams)).resolves.toEqual({
      monitors: [mappedSnapshotMonitor(), mappedEventStreamMonitor],
      next_cursor: "monitor-cursor",
    });
    await expect(
      port.monitor.events("monitor-snapshot", eventParams),
    ).resolves.toEqual({
      events: [
        {
          event_id: "event-snapshot",
          event_group_id: "group-snapshot",
          event_date: "2026-07-09",
          previous_output: mappedJsonOutput,
          changed_output: mappedTextOutput,
          event_type: "snapshot",
        },
        {
          event_id: "event-stream",
          event_group_id: "group-stream",
          event_date: null,
          output: mappedTextOutput,
          event_type: "event_stream",
        },
        {
          error_message: "The scheduled execution exceeded quota.",
          timestamp: "2026-07-09T13:00:00.000Z",
          event_type: "error",
        },
        {
          timestamp: "2026-07-09T14:00:00.000Z",
          event_type: "completion",
        },
      ],
      next_cursor: "event-cursor",
      warnings: [{ message: "Results were truncated." }],
    });
    await expect(port.monitor.cancel("monitor-snapshot")).resolves.toEqual(
      mappedSnapshotMonitor("cancelled"),
    );

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(createParams, createOptions);
    expect(retrieve).toHaveBeenCalledOnce();
    expect(retrieve).toHaveBeenCalledWith("monitor-stream");
    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith(listParams);
    expect(events).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledWith("monitor-snapshot", eventParams);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith("monitor-snapshot");
  });

  it("rejects an event-stream response from snapshot Monitor creation", async () => {
    const client = new Parallel({ apiKey: "test-api-key" });
    const create = vi
      .spyOn(client.monitor, "create")
      .mockResolvedValue(sdkEventStreamMonitor("unexpected-stream"));
    const port = createParallelPort(client);
    const createParams = {
      type: "snapshot",
      frequency: "1d",
      processor: "lite",
      settings: { task_run_id: "run-baseline" },
      metadata: { recipe: "vendor-intel" },
    } satisfies MonitorCreateParams;

    await expect(port.monitor.create(createParams)).rejects.toThrow(
      "Expected a snapshot Monitor, but unexpected-stream is event_stream.",
    );
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(createParams);
  });
});
