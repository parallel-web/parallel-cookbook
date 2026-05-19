import { describe, it, expect, vi, beforeEach } from "vitest";
import { ParallelMonitorClient } from "@/services/parallel-monitor-client.js";
import { ParallelApiError } from "@/models/task-api.js";

// ── Mock parallel-web SDK ──────────────────────────────────────────────────
//
// We mock the SDK constructor so each test can assert it was called with
// the expected V1 payloads. The mock instance exposes monitor.{create,
// retrieve, update, cancel, list, events, trigger}. Pagination tests
// chain mockResolvedValueOnce twice to verify the listAllMonitors loop.

const monitorMethods = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  list: vi.fn(),
  events: vi.fn(),
  trigger: vi.fn(),
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
      monitor = monitorMethods;
      static APIError = MockAPIError;
      constructor(opts: unknown) {
        constructorSpy(opts);
      }
    },
  };
});

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

const minimalMonitor = {
  monitor_id: "mon_abc",
  type: "event_stream" as const,
  frequency: "1d",
  processor: "lite" as const,
  status: "active" as const,
  settings: { query: "Monitor Acme" },
  created_at: "2026-03-05T00:00:00Z",
};

beforeEach(() => {
  for (const m of Object.values(monitorMethods)) m.mockReset();
  constructorSpy.mockReset();
});

// ── Constructor ────────────────────────────────────────────────────────────

describe("ParallelMonitorClient constructor", () => {
  it("instantiates parallel-web with the apiKey + baseURL", () => {
    createClient();
    expect(constructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-key",
        baseURL: "https://api.parallel.ai",
      }),
    );
  });
});

// ── createMonitor ──────────────────────────────────────────────────────────

describe("createMonitor", () => {
  const v1Config = {
    type: "event_stream" as const,
    frequency: "1d",
    processor: "base" as const,
    settings: {
      query: "Monitor Acme Corp for regulatory changes",
      output_schema: {
        type: "json",
        json_schema: { type: "object", properties: {} },
      },
      include_backfill: false,
      advanced_settings: { location: "us" },
    },
    webhook: {
      url: "https://example.com/webhook",
      event_types: ["monitor.event.detected" as const],
    },
    metadata: {
      vendor_name: "Acme Corp",
      vendor_domain: "https://acme.com",
      monitor_category: "regulatory",
      risk_dimension: "compliance",
    },
  };

  it("calls client.monitor.create with the V1 payload", async () => {
    monitorMethods.create.mockResolvedValueOnce(minimalMonitor);
    const client = createClient();

    const result = await client.createMonitor(v1Config);

    expect(monitorMethods.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "event_stream",
        frequency: "1d",
        processor: "base",
        settings: v1Config.settings,
        webhook: v1Config.webhook,
        metadata: v1Config.metadata,
      }),
    );
    expect(result.monitor_id).toBe("mon_abc");
  });

  it("defaults processor to lite when omitted", async () => {
    monitorMethods.create.mockResolvedValueOnce(minimalMonitor);
    const client = createClient();

    await client.createMonitor({
      type: "event_stream",
      frequency: "1d",
      settings: { query: "x" },
    });

    expect(monitorMethods.create).toHaveBeenCalledWith(
      expect.objectContaining({ processor: "lite" }),
    );
  });

  it("translates SDK APIError into ParallelApiError", async () => {
    monitorMethods.create.mockRejectedValueOnce(new MockAPIError("bad", 400));
    const client = createClient();

    await expect(
      client.createMonitor({
        type: "event_stream",
        frequency: "1d",
        settings: { query: "x" },
      }),
    ).rejects.toBeInstanceOf(ParallelApiError);
  });
});

// ── listMonitors / listAllMonitors ─────────────────────────────────────────

describe("listMonitors", () => {
  it("forwards cursor / limit / status / type filters to the SDK", async () => {
    monitorMethods.list.mockResolvedValueOnce({ monitors: [minimalMonitor], next_cursor: null });
    const client = createClient();

    await client.listMonitors({
      cursor: "abc",
      limit: 50,
      status: ["active"],
      type: ["event_stream"],
    });

    expect(monitorMethods.list).toHaveBeenCalledWith({
      cursor: "abc",
      limit: 50,
      status: ["active"],
      type: ["event_stream"],
    });
  });
});

describe("listAllMonitors", () => {
  it("paginates through next_cursor until exhausted", async () => {
    monitorMethods.list
      .mockResolvedValueOnce({
        monitors: [{ ...minimalMonitor, monitor_id: "m1" }],
        next_cursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        monitors: [{ ...minimalMonitor, monitor_id: "m2" }],
        next_cursor: null,
      });
    const client = createClient();

    const all = await client.listAllMonitors({ status: ["active"] });

    expect(all).toHaveLength(2);
    expect(monitorMethods.list).toHaveBeenNthCalledWith(1, {
      status: ["active"],
    });
    expect(monitorMethods.list).toHaveBeenNthCalledWith(2, {
      status: ["active"],
      cursor: "cursor-2",
    });
  });
});

// ── retrieve / update / cancel / trigger ───────────────────────────────────

describe("getMonitor", () => {
  it("calls client.monitor.retrieve", async () => {
    monitorMethods.retrieve.mockResolvedValueOnce(minimalMonitor);
    const client = createClient();

    await client.getMonitor("mon_abc");

    expect(monitorMethods.retrieve).toHaveBeenCalledWith("mon_abc");
  });
});

describe("updateMonitor", () => {
  it("calls client.monitor.update with the updates body", async () => {
    monitorMethods.update.mockResolvedValueOnce(minimalMonitor);
    const client = createClient();

    await client.updateMonitor("mon_abc", { frequency: "12h" });

    expect(monitorMethods.update).toHaveBeenCalledWith("mon_abc", {
      frequency: "12h",
    });
  });
});

describe("cancelMonitor", () => {
  it("calls client.monitor.cancel and returns the cancelled monitor", async () => {
    monitorMethods.cancel.mockResolvedValueOnce({
      ...minimalMonitor,
      status: "cancelled",
    });
    const client = createClient();

    const result = await client.cancelMonitor("mon_abc");

    expect(monitorMethods.cancel).toHaveBeenCalledWith("mon_abc");
    expect(result.status).toBe("cancelled");
  });

  it("deleteMonitor() is a back-compat alias for cancelMonitor()", async () => {
    monitorMethods.cancel.mockResolvedValueOnce({
      ...minimalMonitor,
      status: "cancelled",
    });
    const client = createClient();

    await client.deleteMonitor("mon_abc");

    expect(monitorMethods.cancel).toHaveBeenCalledWith("mon_abc");
  });
});

describe("triggerMonitor", () => {
  it("calls client.monitor.trigger", async () => {
    monitorMethods.trigger.mockResolvedValueOnce(undefined);
    const client = createClient();

    await client.triggerMonitor("mon_abc");

    expect(monitorMethods.trigger).toHaveBeenCalledWith("mon_abc");
  });
});

// ── listEvents (V1 unified endpoint) ───────────────────────────────────────

describe("listEvents", () => {
  it("calls client.monitor.events with event_group_id filter", async () => {
    monitorMethods.events.mockResolvedValueOnce({
      events: [
        {
          event_id: "evt_001",
          event_group_id: "eg_001",
          event_date: "2026-03-05",
          output: {
            type: "json",
            content: {
              event_summary: "Acme breach",
              severity: "CRITICAL",
              adverse: true,
              event_type: "cyber",
            },
            basis: [
              {
                field: "event_summary",
                citations: [{ url: "https://news.example.com/breach" }],
                confidence: "high",
              },
            ],
          },
          event_type: "event_stream",
        },
      ],
      next_cursor: null,
    });
    const client = createClient();

    const page = await client.listEvents("mon_abc", {
      event_group_id: "eg_001",
    });

    expect(monitorMethods.events).toHaveBeenCalledWith("mon_abc", {
      event_group_id: "eg_001",
    });
    expect(page.events).toHaveLength(1);
  });

  it("forwards pagination + include_completions parameters", async () => {
    monitorMethods.events.mockResolvedValueOnce({ events: [], next_cursor: null });
    const client = createClient();

    await client.listEvents("mon_abc", {
      cursor: "cur",
      limit: 50,
      include_completions: true,
    });

    expect(monitorMethods.events).toHaveBeenCalledWith("mon_abc", {
      cursor: "cur",
      limit: 50,
      include_completions: true,
    });
  });
});
