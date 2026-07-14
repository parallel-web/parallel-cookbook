import type Parallel from "parallel-web";
import type {
  Monitor as SdkMonitor,
  MonitorCompletionEvent as SdkMonitorCompletionEvent,
  MonitorErrorEvent as SdkMonitorErrorEvent,
  MonitorEventStreamEvent as SdkMonitorEventStreamEvent,
  MonitorSnapshotEvent as SdkMonitorSnapshotEvent,
} from "parallel-web/resources/monitor";
import type {
  TaskRun as SdkTaskRun,
  TaskRunJsonOutput as SdkTaskRunJsonOutput,
  TaskRunTextOutput as SdkTaskRunTextOutput,
} from "parallel-web/resources/task-run";

import type {
  Monitor,
  MonitorEvent,
  ParallelPort,
  SnapshotMonitor,
  TaskRun,
  TaskRunOutput,
} from "./parallel-port.js";

export interface ParallelSdkClient {
  taskRun: Pick<Parallel["taskRun"], "create" | "retrieve" | "result">;
  monitor: Pick<Parallel["monitor"], "create" | "retrieve" | "list" | "events" | "cancel">;
}

function mapTaskOutput(
  output: SdkTaskRunJsonOutput | SdkTaskRunTextOutput,
): TaskRunOutput {
  return output.type === "json"
    ? { type: "json", content: output.content, basis: output.basis }
    : { type: "text", content: output.content, basis: output.basis };
}

function mapTaskRun(run: SdkTaskRun): TaskRun {
  return {
    run_id: run.run_id,
    interaction_id: run.interaction_id,
    status: run.status,
    ...(run.error
      ? {
          error: {
            message: run.error.message,
            ref_id: run.error.ref_id,
          },
        }
      : {}),
    ...(run.warnings
      ? {
          warnings: run.warnings.map(({ message }) => ({ message })),
        }
      : {}),
  };
}

function mapMonitor(monitor: SdkMonitor): Monitor {
  const shared = {
    monitor_id: monitor.monitor_id,
    status: monitor.status,
    processor: monitor.processor,
    frequency: monitor.frequency,
    created_at: monitor.created_at,
    ...(monitor.metadata ? { metadata: monitor.metadata } : {}),
  };

  if (monitor.type === "snapshot") {
    if (!("task_run_id" in monitor.settings)) {
      throw new Error(
        `Snapshot Monitor ${monitor.monitor_id} did not include a baseline Task run ID.`,
      );
    }
    return {
      ...shared,
      type: "snapshot",
      settings: {
        task_run_id: monitor.settings.task_run_id,
        ...(typeof monitor.settings.query === "string"
          ? { query: monitor.settings.query }
          : {}),
      },
    };
  }

  if (!("query" in monitor.settings) || typeof monitor.settings.query !== "string") {
    throw new Error(`Event-stream Monitor ${monitor.monitor_id} did not include a query.`);
  }
  return {
    ...shared,
    type: "event_stream",
    settings: { query: monitor.settings.query },
  };
}

function mapSnapshotMonitor(monitor: SdkMonitor): SnapshotMonitor {
  const mapped = mapMonitor(monitor);
  if (mapped.type !== "snapshot") {
    throw new Error(
      `Expected a snapshot Monitor, but ${monitor.monitor_id} is ${monitor.type}.`,
    );
  }
  return mapped;
}

function mapMonitorEvent(
  event:
    | SdkMonitorSnapshotEvent
    | SdkMonitorEventStreamEvent
    | SdkMonitorCompletionEvent
    | SdkMonitorErrorEvent,
): MonitorEvent {
  if ("changed_output" in event) {
    return {
      event_id: event.event_id,
      event_group_id: event.event_group_id,
      event_date: event.event_date,
      previous_output: mapTaskOutput(event.previous_output),
      changed_output: mapTaskOutput(event.changed_output),
      event_type: "snapshot",
    };
  }
  if ("output" in event) {
    return {
      event_id: event.event_id,
      event_group_id: event.event_group_id,
      event_date: event.event_date,
      output: mapTaskOutput(event.output),
      event_type: "event_stream",
    };
  }
  if ("error_message" in event) {
    return {
      error_message: event.error_message,
      timestamp: event.timestamp,
      event_type: "error",
    };
  }
  return {
    timestamp: event.timestamp,
    event_type: "completion",
  };
}

/** Adapt the generated SDK client to the small, stable contract used by the recipe. */
export function createParallelPort(client: ParallelSdkClient): ParallelPort {
  return {
    taskRun: {
      async create(params, options) {
        return mapTaskRun(
          await (options
            ? client.taskRun.create(params, options)
            : client.taskRun.create(params)),
        );
      },
      async retrieve(runId) {
        return mapTaskRun(await client.taskRun.retrieve(runId));
      },
      async result(runId, params, options) {
        const result = await client.taskRun.result(runId, params, options);
        return {
          run: mapTaskRun(result.run),
          output: mapTaskOutput(result.output),
        };
      },
    },
    monitor: {
      async create(params, options) {
        return mapSnapshotMonitor(
          await (options
            ? client.monitor.create(params, options)
            : client.monitor.create(params)),
        );
      },
      async retrieve(monitorId) {
        return mapMonitor(await client.monitor.retrieve(monitorId));
      },
      async list(params) {
        const page = await client.monitor.list(params);
        return {
          monitors: page.monitors.map(mapMonitor),
          ...(page.next_cursor !== undefined ? { next_cursor: page.next_cursor } : {}),
        };
      },
      async events(monitorId, params) {
        const page = await client.monitor.events(monitorId, params);
        return {
          events: page.events.map(mapMonitorEvent),
          ...(page.next_cursor !== undefined ? { next_cursor: page.next_cursor } : {}),
          ...(page.warnings
            ? { warnings: page.warnings.map(({ message }) => ({ message })) }
            : {}),
        };
      },
      async cancel(monitorId) {
        return mapMonitor(await client.monitor.cancel(monitorId));
      },
    },
  } satisfies ParallelPort;
}
