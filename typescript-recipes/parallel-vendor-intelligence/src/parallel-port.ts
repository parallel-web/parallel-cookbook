import type {
  TaskRun,
  TaskRunCreateParams,
  TaskRunResult,
  TaskRunResultParams,
} from "parallel-web/resources/task-run";
import type {
  Monitor,
  MonitorCreateParams,
  MonitorEventsParams,
  MonitorListParams,
  PaginatedMonitorEvents,
  PaginatedMonitorResponse,
} from "parallel-web/resources/monitor";

/**
 * The small portion of the Parallel SDK the recipe needs.
 *
 * Depending on a structural interface keeps orchestration tests simple: the real
 * SDK's APIPromise values extend Promise, while test fakes can use ordinary
 * async functions. Transport retries and authentication remain the SDK's job.
 */
export interface ParallelPort {
  taskRun: {
    create(params: TaskRunCreateParams): Promise<TaskRun>;
    result(
      runId: string,
      params?: TaskRunResultParams | null,
      options?: { maxRetries?: number; timeout?: number },
    ): Promise<TaskRunResult>;
  };
  monitor: {
    create(params: MonitorCreateParams): Promise<Monitor>;
    retrieve(monitorId: string): Promise<Monitor>;
    list(params?: MonitorListParams | null): Promise<PaginatedMonitorResponse>;
    events(
      monitorId: string,
      params?: MonitorEventsParams | null,
    ): Promise<PaginatedMonitorEvents>;
    cancel(monitorId: string): Promise<Monitor>;
  };
}
