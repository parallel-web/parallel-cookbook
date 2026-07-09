import Parallel from "parallel-web";
import {
  ParallelApiError,
  type Monitor,
  type MonitorCreateInput,
  type MonitorEventsInput,
  type MonitorListInput,
  type PaginatedMonitorEvents,
} from "./types";

export interface ParallelMonitorClientOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  timeout?: number;
}

/**
 * Dashboard-side Parallel Monitor V1 client. Wraps `parallel-web` so the
 * Next.js server can talk to the V1 endpoints (`/v1/monitors`) without
 * hand-rolling fetch + retry logic. Mirrors
 * `src/services/parallel-monitor-client.ts` in the n8n-procurement
 * package.
 */
export class ParallelMonitorClient {
  private readonly sdk: Parallel;

  constructor(options: ParallelMonitorClientOptions) {
    this.sdk = new Parallel({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      maxRetries: options.maxRetries ?? 3,
      timeout: options.timeout ?? 60_000,
    });
  }

  async createMonitor(config: MonitorCreateInput): Promise<Monitor> {
    return await this.invoke(async () => {
      const monitor = await this.sdk.monitor.create({
        type: config.type,
        frequency: config.frequency,
        processor: config.processor ?? "lite",
        settings: config.settings as never,
        ...(config.webhook ? { webhook: config.webhook } : {}),
        ...(config.metadata ? { metadata: config.metadata } : {}),
      } as Parameters<Parallel["monitor"]["create"]>[0]);
      return monitor as unknown as Monitor;
    });
  }

  async getMonitor(monitorId: string): Promise<Monitor> {
    return await this.invoke(async () => {
      const monitor = await this.sdk.monitor.retrieve(monitorId);
      return monitor as unknown as Monitor;
    });
  }

  /** V1 cancellation. Irreversible; create a new monitor to "restart". */
  async cancelMonitor(monitorId: string): Promise<Monitor> {
    return await this.invoke(async () => {
      const monitor = await this.sdk.monitor.cancel(monitorId);
      return monitor as unknown as Monitor;
    });
  }

  /** Back-compat alias for existing callers expecting `deleteMonitor`. */
  async deleteMonitor(monitorId: string): Promise<void> {
    await this.cancelMonitor(monitorId);
  }

  /** Fire an off-schedule one-off run (used by the dashboard "refresh now" path). */
  async triggerMonitor(monitorId: string): Promise<void> {
    await this.invoke(() => this.sdk.monitor.trigger(monitorId));
  }

  async listMonitors(params?: MonitorListInput): Promise<{
    monitors: Monitor[];
    next_cursor?: string | null;
  }> {
    return await this.invoke(async () => {
      const page = await this.sdk.monitor.list({
        ...(params?.cursor ? { cursor: params.cursor } : {}),
        ...(params?.limit ? { limit: params.limit } : {}),
        ...(params?.status ? { status: params.status } : {}),
        ...(params?.type ? { type: params.type } : {}),
      });
      return {
        monitors: page.monitors as unknown as Monitor[],
        next_cursor: page.next_cursor,
      };
    });
  }

  /**
   * V1 unified events endpoint. Pass `event_group_id` to resolve the
   * single execution that fired a webhook; omit to paginate the most
   * recent events newest-first.
   */
  async listEvents(
    monitorId: string,
    params?: MonitorEventsInput,
  ): Promise<PaginatedMonitorEvents> {
    return await this.invoke(async () => {
      const page = await this.sdk.monitor.events(monitorId, {
        ...(params?.cursor ? { cursor: params.cursor } : {}),
        ...(params?.limit ? { limit: params.limit } : {}),
        ...(params?.event_group_id
          ? { event_group_id: params.event_group_id }
          : {}),
        ...(params?.include_completions !== undefined
          ? { include_completions: params.include_completions }
          : {}),
      });
      return page as unknown as PaginatedMonitorEvents;
    });
  }

  // Translate parallel-web APIErrors into the dashboard's
  // ParallelApiError so the route handlers keep their existing catch
  // shapes. SDK already retries 408/409/429/5xx with backoff.
  private async invoke<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Parallel.APIError) {
        throw new ParallelApiError(
          `Parallel API ${err.status ?? "?"}: ${err.name}`,
          err.status ?? 0,
          (err as { message?: string }).message ?? "",
        );
      }
      throw err;
    }
  }
}
