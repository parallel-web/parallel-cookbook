import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  AxiosError,
} from "axios";
import { ParallelApiError } from "../models/task-api.js";
import {
  MonitorSchema,
  MonitorListResponseSchema,
  MonitorEventSchema,
  EventGroupDetailsSchema,
  type Monitor,
  type MonitorListResponse,
  type MonitorEvent,
  type EventGroupDetails,
  type MonitorCreateInput,
  type MonitorUpdateInput,
} from "../models/monitor-api.js";

// ── Constants ──────────────────────────────────────────────────────────────

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

// ── Options ────────────────────────────────────────────────────────────────

export interface ParallelMonitorClientOptions {
  apiKey: string;
  baseUrl?: string;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Client ─────────────────────────────────────────────────────────────────

export class ParallelMonitorClient {
  private readonly http: AxiosInstance;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  constructor(options: ParallelMonitorClientOptions) {
    this.log = options.logger ?? console;

    this.http = axios.create({
      baseURL: options.baseUrl ?? "https://api.parallel.ai",
      headers: {
        "x-api-key": options.apiKey,
        "Content-Type": "application/json",
      },
      timeout: 60_000,
    });
  }

  // ── Monitor CRUD ───────────────────────────────────────────────────────

  async createMonitor(config: MonitorCreateInput): Promise<Monitor> {
    this.log.debug("[parallel] POST /v1alpha/monitors", {
      cadence: config.cadence,
      hasWebhook: !!config.webhook,
      hasMetadata: !!config.metadata,
    });

    const data = await this.requestWithRetry<unknown>({
      method: "POST",
      url: "/v1alpha/monitors",
      data: config,
    });

    return MonitorSchema.parse(data);
  }

  async listMonitors(params?: {
    limit?: number;
    offset?: number;
  }): Promise<MonitorListResponse> {
    this.log.debug("[parallel] GET /v1alpha/monitors", params);

    const data = await this.requestWithRetry<unknown>({
      method: "GET",
      url: "/v1alpha/monitors",
      params,
    });

    return MonitorListResponseSchema.parse(data);
  }

  async getMonitor(monitorId: string): Promise<Monitor> {
    this.log.debug("[parallel] GET /v1alpha/monitors/%s", monitorId);

    const data = await this.requestWithRetry<unknown>({
      method: "GET",
      url: `/v1alpha/monitors/${monitorId}`,
    });

    return MonitorSchema.parse(data);
  }

  async updateMonitor(
    monitorId: string,
    updates: MonitorUpdateInput,
  ): Promise<Monitor> {
    this.log.debug("[parallel] PATCH /v1alpha/monitors/%s", monitorId);

    const data = await this.requestWithRetry<unknown>({
      method: "PATCH",
      url: `/v1alpha/monitors/${monitorId}`,
      data: updates,
    });

    return MonitorSchema.parse(data);
  }

  async deleteMonitor(monitorId: string): Promise<void> {
    this.log.debug("[parallel] DELETE /v1alpha/monitors/%s", monitorId);

    await this.requestWithRetry<unknown>({
      method: "DELETE",
      url: `/v1alpha/monitors/${monitorId}`,
    });
  }

  // ── Monitor Events ─────────────────────────────────────────────────────

  async getMonitorEvents(
    monitorId: string,
    params?: { limit?: number },
  ): Promise<MonitorEvent[]> {
    this.log.debug(
      "[parallel] GET /v1alpha/monitors/%s/events",
      monitorId,
    );

    const data = await this.requestWithRetry<unknown>({
      method: "GET",
      url: `/v1alpha/monitors/${monitorId}/events`,
      params,
    });

    // API may return { events: [...] } or bare array
    const events = Array.isArray(data)
      ? data
      : (data as { events: unknown[] }).events;

    return events.map((e: unknown) => MonitorEventSchema.parse(e));
  }

  async getEventGroupDetails(
    monitorId: string,
    eventGroupId: string,
  ): Promise<EventGroupDetails> {
    this.log.debug(
      "[parallel] GET /v1alpha/monitors/%s/event_groups/%s",
      monitorId,
      eventGroupId,
    );

    const data = await this.requestWithRetry<unknown>({
      method: "GET",
      url: `/v1alpha/monitors/${monitorId}/event_groups/${eventGroupId}`,
    });

    return EventGroupDetailsSchema.parse(data);
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private async requestWithRetry<T>(
    config: AxiosRequestConfig,
    maxRetries: number = 3,
    initialDelayMs: number = 1000,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.http.request<T>(config);
        return response.data;
      } catch (err) {
        if (!(err instanceof AxiosError) || !err.response) {
          throw err;
        }

        const status = err.response.status;
        lastError = err;

        if (!RETRYABLE_STATUS_CODES.has(status) || attempt === maxRetries) {
          const body =
            typeof err.response.data === "string"
              ? err.response.data
              : JSON.stringify(err.response.data ?? "");
          throw new ParallelApiError(
            `Parallel API error ${status}: ${config.method?.toUpperCase()} ${config.url}`,
            status,
            body,
          );
        }

        let delayMs = initialDelayMs * Math.pow(2, attempt);

        if (status === 429) {
          const retryAfter = err.response.headers?.["retry-after"];
          if (retryAfter) {
            const retryAfterMs = Number(retryAfter) * 1000;
            if (!isNaN(retryAfterMs) && retryAfterMs > delayMs) {
              delayMs = retryAfterMs;
            }
          }
        }

        this.log.debug(
          "[parallel] Retrying %s %s (attempt %d/%d, status %d, delay %dms)",
          config.method?.toUpperCase(),
          config.url,
          attempt + 1,
          maxRetries,
          status,
          delayMs,
        );

        await this.sleep(delayMs);
      }
    }

    throw lastError ?? new Error("Unexpected retry exhaustion");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
