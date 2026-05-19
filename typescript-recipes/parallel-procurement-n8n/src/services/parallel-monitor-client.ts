import Parallel from "parallel-web";
import { ParallelApiError } from "../models/task-api.js";
import {
  MonitorSchema,
  PaginatedMonitorResponseSchema,
  PaginatedMonitorEventsSchema,
  type Monitor,
  type PaginatedMonitorResponse,
  type PaginatedMonitorEvents,
  type MonitorCreateInput,
  type MonitorUpdateInput,
  type MonitorListInput,
  type MonitorEventsInput,
} from "../models/monitor-api.js";

// ── Options ────────────────────────────────────────────────────────────────

export interface ParallelMonitorClientOptions {
  apiKey: string;
  baseUrl?: string;
  /**
   * Per-request timeout in milliseconds. Defaults to 60s (matches the SDK
   * default). Lower for snappy operations like list/cancel, raise for any
   * trigger() calls that block on a fresh run.
   */
  timeout?: number;
  /**
   * SDK-level retry count for connection errors + 5xx + 429 + 408 + 409.
   * Defaults to 3.
   */
  maxRetries?: number;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Client ─────────────────────────────────────────────────────────────────

// Wraps the official `parallel-web` SDK with our zod validation and our
// procurement-specific error type. We *deliberately* call the SDK rather
// than the raw HTTP API so we get typed responses, auto-retry, and free
// upgrades when the API evolves.
export class ParallelMonitorClient {
  private readonly sdk: Parallel;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  constructor(options: ParallelMonitorClientOptions) {
    this.log = options.logger ?? console;
    this.sdk = new Parallel({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      timeout: options.timeout ?? 60_000,
      maxRetries: options.maxRetries ?? 3,
    });
  }

  // ── Monitor CRUD ───────────────────────────────────────────────────────

  async createMonitor(config: MonitorCreateInput): Promise<Monitor> {
    this.log.debug("[parallel] monitor.create", {
      type: config.type,
      frequency: config.frequency,
      processor: config.processor ?? "lite",
      hasWebhook: !!config.webhook,
    });

    // The SDK narrows `settings` based on `type`, but our domain accepts a
    // broader output_schema shape (callers may pass a pre-built JSON
    // schema object). Cast through the SDK params type so we don't fight
    // the discriminated union here.
    const data = await this.invoke(() =>
      this.sdk.monitor.create({
        type: config.type,
        frequency: config.frequency,
        processor: config.processor ?? "lite",
        settings: config.settings as never,
        ...(config.webhook ? { webhook: config.webhook } : {}),
        ...(config.metadata ? { metadata: config.metadata } : {}),
      } as Parameters<Parallel["monitor"]["create"]>[0]),
    );

    return MonitorSchema.parse(data);
  }

  async listMonitors(params?: MonitorListInput): Promise<PaginatedMonitorResponse> {
    this.log.debug("[parallel] monitor.list", params);

    const data = await this.invoke(() =>
      this.sdk.monitor.list({
        ...(params?.cursor ? { cursor: params.cursor } : {}),
        ...(params?.limit ? { limit: params.limit } : {}),
        ...(params?.status ? { status: params.status } : {}),
        ...(params?.type ? { type: params.type } : {}),
      }),
    );

    return PaginatedMonitorResponseSchema.parse(data);
  }

  /**
   * Convenience helper that pages through every monitor matching `params`
   * until `next_cursor` is absent. The list endpoint caps at 10000 per
   * page but we keep the loop safe-by-default.
   */
  async listAllMonitors(params?: Omit<MonitorListInput, "cursor">): Promise<Monitor[]> {
    const all: Monitor[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listMonitors({ ...params, cursor });
      all.push(...page.monitors);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return all;
  }

  async getMonitor(monitorId: string): Promise<Monitor> {
    this.log.debug("[parallel] monitor.retrieve %s", monitorId);

    const data = await this.invoke(() => this.sdk.monitor.retrieve(monitorId));
    return MonitorSchema.parse(data);
  }

  async updateMonitor(
    monitorId: string,
    updates: MonitorUpdateInput,
  ): Promise<Monitor> {
    this.log.debug("[parallel] monitor.update %s", monitorId);

    const data = await this.invoke(() =>
      this.sdk.monitor.update(monitorId, updates as Parameters<
        Parallel["monitor"]["update"]
      >[1]),
    );

    return MonitorSchema.parse(data);
  }

  /**
   * V1 monitor cancellation. Cancellation is irreversible (per the V1
   * docs); to "restart" a monitor, create a new one with the same
   * settings.
   */
  async cancelMonitor(monitorId: string): Promise<Monitor> {
    this.log.debug("[parallel] monitor.cancel %s", monitorId);

    const data = await this.invoke(() => this.sdk.monitor.cancel(monitorId));
    return MonitorSchema.parse(data);
  }

  /** Back-compat alias — earlier code called this `deleteMonitor`. */
  async deleteMonitor(monitorId: string): Promise<void> {
    await this.cancelMonitor(monitorId);
  }

  /**
   * Enqueue an off-schedule one-off execution. Used by the health checker
   * to refresh a freshly-recreated monitor without waiting for the next
   * cron tick.
   */
  async triggerMonitor(monitorId: string): Promise<void> {
    this.log.debug("[parallel] monitor.trigger %s", monitorId);
    await this.invoke(() => this.sdk.monitor.trigger(monitorId));
  }

  // ── Monitor Events ─────────────────────────────────────────────────────

  /**
   * V1 unified events endpoint. Pass `event_group_id` to fetch the single
   * execution that came in via webhook; otherwise paginate newest-first
   * with `cursor` + `limit`.
   */
  async listEvents(
    monitorId: string,
    params?: MonitorEventsInput,
  ): Promise<PaginatedMonitorEvents> {
    this.log.debug("[parallel] monitor.events %s", monitorId, params);

    const data = await this.invoke(() =>
      this.sdk.monitor.events(monitorId, {
        ...(params?.cursor ? { cursor: params.cursor } : {}),
        ...(params?.limit ? { limit: params.limit } : {}),
        ...(params?.event_group_id
          ? { event_group_id: params.event_group_id }
          : {}),
        ...(params?.include_completions !== undefined
          ? { include_completions: params.include_completions }
          : {}),
      }),
    );

    return PaginatedMonitorEventsSchema.parse(data);
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  // The SDK ships with built-in exponential backoff for 408/409/429/5xx so
  // we don't need our own retry loop. We just translate APIErrors into the
  // procurement-specific ParallelApiError so the rest of the codebase can
  // keep its existing catch blocks.
  private async invoke<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Parallel.APIError) {
        throw new ParallelApiError(
          `Parallel API error ${err.status ?? "?"}: ${err.name}`,
          err.status ?? 0,
          (err as { message?: string }).message ?? "",
        );
      }
      throw err;
    }
  }
}
