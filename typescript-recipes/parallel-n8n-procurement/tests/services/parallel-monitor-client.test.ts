import { describe, it, expect, vi, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { ParallelMonitorClient } from "@/services/parallel-monitor-client.js";
import { ParallelApiError } from "@/models/task-api.js";

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
  return new ParallelMonitorClient({
    apiKey: "test-key",
    baseUrl: "https://api.parallel.ai",
    logger: silentLogger,
  });
}

function mockResponse<T>(data: T, status = 200) {
  return { data, status, statusText: "OK", headers: {}, config: {} };
}

function makeAxiosError(status: number, body: unknown = "", headers: Record<string, string> = {}) {
  return new AxiosError(
    `Request failed with status ${status}`,
    String(status),
    undefined,
    undefined,
    { data: body, status, statusText: "", headers, config: {} as never } as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ── Constructor ────────────────────────────────────────────────────────────

describe("ParallelMonitorClient constructor", () => {
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

// ── createMonitor ──────────────────────────────────────────────────────────

describe("createMonitor", () => {
  const monitorConfig = {
    query: "Monitor Acme Corp for regulatory changes and adverse news",
    cadence: "daily" as const,
    webhook: {
      url: "https://example.com/webhook",
      event_types: ["monitor.event.detected"],
    },
    metadata: {
      vendor_name: "Acme Corp",
      vendor_domain: "https://acme.com",
      monitor_category: "regulatory",
      risk_dimension: "compliance",
    },
    output_schema: {
      type: "json",
      json_schema: {
        properties: {
          event_summary: { type: "string" },
          severity: { type: "string" },
          adverse: { type: "boolean" },
          event_type: { type: "string" },
        },
      },
    },
  };

  it("sends POST with full payload", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        monitor_id: "mon_abc",
        query: monitorConfig.query,
        status: "active",
        cadence: "daily",
        metadata: monitorConfig.metadata,
        created_at: "2026-03-05T00:00:00Z",
      }),
    );

    const result = await client.createMonitor(monitorConfig);

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/v1alpha/monitors",
        data: monitorConfig,
      }),
    );
    expect(result.monitor_id).toBe("mon_abc");
    expect(result.status).toBe("active");
  });

  it("sends minimal payload without webhook or metadata", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        monitor_id: "mon_abc",
        query: "Monitor vendor",
        status: "active",
        cadence: "weekly",
      }),
    );

    await client.createMonitor({
      query: "Monitor vendor",
      cadence: "weekly",
    });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { query: "Monitor vendor", cadence: "weekly" },
      }),
    );
  });

  it("throws ParallelApiError on 400", async () => {
    const client = createClient();
    mockRequest.mockRejectedValueOnce(makeAxiosError(400, "Invalid payload"));

    await expect(
      client.createMonitor({ query: "", cadence: "daily" }),
    ).rejects.toThrow(ParallelApiError);
  });
});

// ── listMonitors ───────────────────────────────────────────────────────────

describe("listMonitors", () => {
  it("sends GET with no params", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        monitors: [
          { monitor_id: "m1", query: "q1", status: "active", cadence: "daily" },
        ],
        total_count: 1,
      }),
    );

    const result = await client.listMonitors();

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/v1alpha/monitors",
      }),
    );
    expect(result.monitors).toHaveLength(1);
  });

  it("sends GET with pagination params", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ monitors: [], total_count: 0 }),
    );

    await client.listMonitors({ limit: 10, offset: 20 });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { limit: 10, offset: 20 },
      }),
    );
  });
});

// ── getMonitor ─────────────────────────────────────────────────────────────

describe("getMonitor", () => {
  it("sends GET to correct endpoint", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        monitor_id: "mon_123",
        query: "Monitor vendor",
        status: "active",
        cadence: "daily",
      }),
    );

    const result = await client.getMonitor("mon_123");

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/v1alpha/monitors/mon_123",
      }),
    );
    expect(result.monitor_id).toBe("mon_123");
  });
});

// ── updateMonitor ──────────────────────────────────────────────────────────

describe("updateMonitor", () => {
  it("sends PATCH with updates", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        monitor_id: "mon_123",
        query: "Monitor vendor",
        status: "active",
        cadence: "weekly",
      }),
    );

    const result = await client.updateMonitor("mon_123", {
      cadence: "weekly",
    });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        url: "/v1alpha/monitors/mon_123",
        data: { cadence: "weekly" },
      }),
    );
    expect(result.cadence).toBe("weekly");
  });

  it("sends PATCH with webhook and metadata updates", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        monitor_id: "mon_123",
        query: "q",
        status: "active",
        cadence: "daily",
        webhook: { url: "https://new.com/hook", event_types: [] },
      }),
    );

    await client.updateMonitor("mon_123", {
      webhook: { url: "https://new.com/hook", event_types: [] },
      metadata: { vendor_name: "Updated Corp" },
    });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          webhook: { url: "https://new.com/hook", event_types: [] },
          metadata: { vendor_name: "Updated Corp" },
        },
      }),
    );
  });
});

// ── deleteMonitor ──────────────────────────────────────────────────────────

describe("deleteMonitor", () => {
  it("sends DELETE and returns void", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(mockResponse(null, 204));

    const result = await client.deleteMonitor("mon_123");

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        url: "/v1alpha/monitors/mon_123",
      }),
    );
    expect(result).toBeUndefined();
  });

  it("throws ParallelApiError on 404", async () => {
    const client = createClient();
    mockRequest.mockRejectedValueOnce(makeAxiosError(404, "Not found"));

    await expect(client.deleteMonitor("mon_bad")).rejects.toThrow(
      ParallelApiError,
    );
  });
});

// ── getMonitorEvents ───────────────────────────────────────────────────────

describe("getMonitorEvents", () => {
  it("parses events from { events: [...] } response", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        events: [
          {
            type: "event",
            event_id: "evt_1",
            event_group_id: "eg_1",
            monitor_id: "mon_123",
            event_date: "2026-03-05",
            output: "Vendor fined by regulator",
            source_urls: ["https://news.example.com"],
          },
          { type: "completion", event_id: "evt_2", monitor_id: "mon_123" },
        ],
      }),
    );

    const events = await client.getMonitorEvents("mon_123");

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("event");
    expect(events[0].output).toBe("Vendor fined by regulator");
    expect(events[1].type).toBe("completion");
  });

  it("parses events from bare array response", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse([
        { type: "event", event_id: "evt_1", output: "finding" },
      ]),
    );

    const events = await client.getMonitorEvents("mon_123");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("event");
  });

  it("sends limit param when provided", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({ events: [] }),
    );

    await client.getMonitorEvents("mon_123", { limit: 5 });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/v1alpha/monitors/mon_123/events",
        params: { limit: 5 },
      }),
    );
  });

  it("handles events with object output", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        events: [
          {
            type: "event",
            output: {
              event_summary: "Regulatory action",
              severity: "HIGH",
              adverse: true,
              event_type: "regulatory",
            },
          },
        ],
      }),
    );

    const events = await client.getMonitorEvents("mon_123");

    expect(events[0].output).toEqual({
      event_summary: "Regulatory action",
      severity: "HIGH",
      adverse: true,
      event_type: "regulatory",
    });
  });
});

// ── getEventGroupDetails ───────────────────────────────────────────────────

describe("getEventGroupDetails", () => {
  it("sends GET to correct nested endpoint", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        event_group_id: "eg_123",
        monitor_id: "mon_456",
        events: [
          { type: "event", event_id: "evt_1", output: "Details here" },
        ],
      }),
    );

    const result = await client.getEventGroupDetails("mon_456", "eg_123");

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/v1alpha/monitors/mon_456/event_groups/eg_123",
      }),
    );
    expect(result.event_group_id).toBe("eg_123");
    expect(result.events).toHaveLength(1);
  });

  it("includes metadata when present", async () => {
    const client = createClient();
    mockRequest.mockResolvedValueOnce(
      mockResponse({
        event_group_id: "eg_123",
        monitor_id: "mon_456",
        events: [],
        metadata: { vendor_name: "Acme" },
      }),
    );

    const result = await client.getEventGroupDetails("mon_456", "eg_123");

    expect(result.metadata).toEqual({ vendor_name: "Acme" });
  });
});

// ── Retry Logic ────────────────────────────────────────────────────────────

describe("retry logic", () => {
  it("retries on 429 and succeeds", async () => {
    vi.useFakeTimers();
    const client = createClient();

    mockRequest
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce(
        mockResponse({
          monitor_id: "mon_1",
          query: "q",
          status: "active",
          cadence: "daily",
        }),
      );

    const promise = client.getMonitor("mon_1");

    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.monitor_id).toBe("mon_1");
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 400", async () => {
    const client = createClient();
    mockRequest.mockRejectedValueOnce(makeAxiosError(400));

    await expect(client.getMonitor("mon_1")).rejects.toThrow(ParallelApiError);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("retries on 500 with exponential backoff", async () => {
    vi.useFakeTimers();
    const client = createClient();

    mockRequest
      .mockRejectedValueOnce(makeAxiosError(500))
      .mockRejectedValueOnce(makeAxiosError(500))
      .mockResolvedValueOnce(
        mockResponse({
          monitor_id: "mon_1",
          query: "q",
          status: "active",
          cadence: "daily",
        }),
      );

    const promise = client.getMonitor("mon_1");

    await vi.advanceTimersByTimeAsync(1000); // 1s
    await vi.advanceTimersByTimeAsync(2000); // 2s

    const result = await promise;
    expect(result.monitor_id).toBe("mon_1");
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });
});
