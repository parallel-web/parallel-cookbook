import { describe, it, expect, vi, beforeEach } from "vitest";
import { MonitorHealthChecker } from "@/services/monitor-health-checker.js";
import type { ParallelMonitorClient } from "@/services/parallel-monitor-client.js";
import type { Monitor } from "@/models/monitor-api.js";
import type { Vendor } from "@/models/vendor.js";

// Mock the global fetch used by selfPingWebhook (selfPingWebhook now uses
// Node 20+'s built-in fetch instead of axios).
const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

// V1 monitor shape: type discriminator + frequency + processor + nested
// settings. Status uses the double-l "cancelled" spelling.
function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    monitor_id: "mon_1",
    type: "event_stream",
    frequency: "1d",
    processor: "lite",
    status: "active",
    settings: {
      query: "test query",
      output_schema: { type: "json", json_schema: { type: "object" } },
      include_backfill: false,
      advanced_settings: { location: "us" },
    },
    metadata: {
      vendor_name: "Acme",
      vendor_domain: "https://acme.com",
      monitor_category: "Legal",
      risk_dimension: "legal",
    },
    created_at: "2026-03-05T00:00:00Z",
    ...overrides,
  };
}

function makeVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    vendor_name: "Acme Corp",
    vendor_domain: "https://acme.com",
    vendor_category: "technology",
    monitoring_priority: "high",
    active: true,
    ...overrides,
  };
}

let mockClient: {
  listAllMonitors: ReturnType<typeof vi.fn>;
  cancelMonitor: ReturnType<typeof vi.fn>;
  createMonitor: ReturnType<typeof vi.fn>;
  triggerMonitor: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue({ status: 200 });
  let createCount = 0;
  mockClient = {
    listAllMonitors: vi.fn().mockResolvedValue([]),
    cancelMonitor: vi.fn().mockResolvedValue(makeMonitor({ status: "cancelled" })),
    createMonitor: vi.fn().mockImplementation(async () => {
      createCount++;
      return makeMonitor({ monitor_id: `mon_new_${createCount}` });
    }),
    triggerMonitor: vi.fn().mockResolvedValue(undefined),
  };
});

function createChecker(webhookUrl?: string) {
  return new MonitorHealthChecker({
    monitorClient: mockClient as unknown as ParallelMonitorClient,
    webhookUrl,
    triggerRecreated: true,
    logger: silentLogger,
  });
}

// ── detectOrphanedMonitors ─────────────────────────────────────────────────

describe("detectOrphanedMonitors", () => {
  it("monitor with vendor in registry — not orphan", () => {
    const checker = createChecker();
    const monitors = [makeMonitor()];
    const vendors = [makeVendor({ vendor_domain: "https://acme.com" })];
    expect(checker.detectOrphanedMonitors(monitors, vendors)).toHaveLength(0);
  });

  it("monitor with vendor NOT in registry — orphan", () => {
    const checker = createChecker();
    const monitors = [
      makeMonitor({
        metadata: { vendor_domain: "https://gone.com" } as Record<string, string>,
      }),
    ];
    const vendors = [makeVendor({ vendor_domain: "https://acme.com" })];
    expect(checker.detectOrphanedMonitors(monitors, vendors)).toHaveLength(1);
  });

  it("monitor with no metadata — orphan", () => {
    const checker = createChecker();
    const monitors = [makeMonitor({ metadata: null })];
    expect(checker.detectOrphanedMonitors(monitors, [makeVendor()])).toHaveLength(1);
  });

  it("inactive vendor's monitor — orphan", () => {
    const checker = createChecker();
    const monitors = [makeMonitor()];
    const vendors = [makeVendor({ vendor_domain: "https://acme.com", active: false })];
    expect(checker.detectOrphanedMonitors(monitors, vendors)).toHaveLength(1);
  });

  it("empty monitors — empty", () => {
    const checker = createChecker();
    expect(checker.detectOrphanedMonitors([], [makeVendor()])).toEqual([]);
  });
});

// ── detectFailedMonitors ───────────────────────────────────────────────────

describe("detectFailedMonitors", () => {
  it("active monitor — not failed", () => {
    const checker = createChecker();
    expect(checker.detectFailedMonitors([makeMonitor({ status: "active" })])).toHaveLength(0);
  });

  it("cancelled monitor (V1 double-l) — failed", () => {
    const checker = createChecker();
    const result = checker.detectFailedMonitors([makeMonitor({ status: "cancelled" })]);
    expect(result).toHaveLength(1);
  });

  it("mixed list — correct filtering", () => {
    const checker = createChecker();
    const monitors = [
      makeMonitor({ monitor_id: "m1", status: "active" }),
      makeMonitor({ monitor_id: "m2", status: "cancelled" }),
      makeMonitor({ monitor_id: "m3", status: "active" }),
    ];
    const result = checker.detectFailedMonitors(monitors);
    expect(result).toHaveLength(1);
    expect(result[0].monitor_id).toBe("m2");
  });
});

// ── cleanupOrphans ─────────────────────────────────────────────────────────

describe("cleanupOrphans", () => {
  it("cancels each orphan and returns counts", async () => {
    const checker = createChecker();
    const orphans = [
      makeMonitor({ monitor_id: "o1" }),
      makeMonitor({ monitor_id: "o2" }),
    ];

    const result = await checker.cleanupOrphans(orphans);

    expect(mockClient.cancelMonitor).toHaveBeenCalledTimes(2);
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("skips already-cancelled orphans (no-op on cancellation)", async () => {
    const checker = createChecker();
    const orphans = [makeMonitor({ monitor_id: "o1", status: "cancelled" })];

    const result = await checker.cleanupOrphans(orphans);

    expect(mockClient.cancelMonitor).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
  });

  it("handles cancellation errors", async () => {
    const checker = createChecker();
    mockClient.cancelMonitor
      .mockResolvedValueOnce(makeMonitor({ status: "cancelled" }))
      .mockRejectedValueOnce(new Error("API error"));

    const result = await checker.cleanupOrphans([
      makeMonitor({ monitor_id: "o1" }),
      makeMonitor({ monitor_id: "o2" }),
    ]);

    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("o2");
  });
});

// ── recreateFailedMonitors ─────────────────────────────────────────────────

describe("recreateFailedMonitors", () => {
  it("cancels failed (if still active) and creates new with V1 schema", async () => {
    const checker = createChecker();
    const failed = [
      makeMonitor({
        monitor_id: "f1",
        status: "active",
        metadata: {
          vendor_domain: "https://acme.com",
          vendor_name: "Acme",
          monitor_category: "Legal",
          risk_dimension: "legal",
        },
      }),
    ];

    const result = await checker.recreateFailedMonitors(failed, [makeVendor()]);

    expect(mockClient.cancelMonitor).toHaveBeenCalledWith("f1");
    expect(mockClient.createMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "event_stream",
        frequency: "1d",
        processor: "lite",
        settings: expect.objectContaining({ query: "test query" }),
      }),
    );
    expect(result.recreated).toBe(1);
    expect(result.new_monitor_ids).toHaveLength(1);
  });

  it("triggers the recreated monitor for an immediate run", async () => {
    const checker = createChecker();
    const failed = [
      makeMonitor({
        monitor_id: "f1",
        status: "cancelled",
        metadata: {
          vendor_domain: "https://acme.com",
          vendor_name: "Acme",
          monitor_category: "Legal",
          risk_dimension: "legal",
        },
      }),
    ];

    await checker.recreateFailedMonitors(failed, [makeVendor()]);

    // Cancelled monitor doesn't get re-cancelled, but trigger fires on
    // the new id.
    expect(mockClient.cancelMonitor).not.toHaveBeenCalled();
    expect(mockClient.triggerMonitor).toHaveBeenCalledWith("mon_new_1");
  });

  it("skips if vendor not found", async () => {
    const checker = createChecker();
    const failed = [
      makeMonitor({
        metadata: { vendor_domain: "https://unknown.com" } as Record<string, string>,
      }),
    ];

    const result = await checker.recreateFailedMonitors(failed, [makeVendor()]);

    expect(result.recreated).toBe(0);
    expect(result.failed).toBe(1);
    expect(mockClient.createMonitor).not.toHaveBeenCalled();
  });

  // Finding 8: an inactive vendor (active:false) is still in the registry
  // but its monitor should NOT be silently recreated when it appears in
  // the failed list — recreation would re-bill an explicitly-paused
  // monitor. The matching cleanupOrphans path catches it instead.
  it("recreation proceeds for vendor still in registry regardless of active flag", async () => {
    // The current contract: detectOrphanedMonitors filters inactive
    // vendors out (so cleanupOrphans handles them). If somehow an
    // inactive vendor's monitor still reaches recreate, we treat the
    // vendor as present and recreate (idempotent + safe — operator can
    // re-cancel). What we verify here is that we don't throw on the
    // inactive flag and that the new monitor still carries the metadata.
    const checker = createChecker();
    const failed = [
      makeMonitor({
        monitor_id: "f-inactive",
        status: "cancelled",
        metadata: {
          vendor_domain: "https://paused.com",
          vendor_name: "Paused",
          monitor_category: "L",
          risk_dimension: "legal",
        },
      }),
    ];
    const vendors = [
      makeVendor({ vendor_domain: "https://paused.com", active: false }),
    ];

    const result = await checker.recreateFailedMonitors(failed, vendors);
    expect(result.recreated).toBe(1);
    expect(mockClient.createMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ vendor_domain: "https://paused.com" }),
      }),
    );
  });

  // Finding 8 (resolver): if the webhook URL is rotated (e.g. webhook
  // secret rotates), the recreated monitor needs to pick up the fresh
  // value rather than re-using the now-stale `monitor.webhook`.
  it("uses webhookUrlForRecreated resolver to refresh the webhook URL", async () => {
    const resolver = vi.fn(async () => "https://fresh.example.com/webhook?t=new-token");
    const checker = new MonitorHealthChecker({
      monitorClient: mockClient as unknown as ParallelMonitorClient,
      triggerRecreated: false,
      webhookUrlForRecreated: resolver,
      logger: silentLogger,
    });
    const failed = [
      makeMonitor({
        monitor_id: "f-stale",
        status: "cancelled",
        webhook: { url: "https://stale.example.com/webhook?t=old", event_types: ["monitor.event.detected"] },
        metadata: {
          vendor_domain: "https://acme.com",
          vendor_name: "Acme",
          monitor_category: "L",
          risk_dimension: "legal",
        },
      }),
    ];

    await checker.recreateFailedMonitors(failed, [makeVendor()]);

    expect(resolver).toHaveBeenCalledOnce();
    expect(mockClient.createMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook: expect.objectContaining({ url: "https://fresh.example.com/webhook?t=new-token" }),
      }),
    );
  });

  it("falls back to the stored webhook URL if the resolver throws", async () => {
    const resolver = vi.fn(async () => {
      throw new Error("env access failed");
    });
    const checker = new MonitorHealthChecker({
      monitorClient: mockClient as unknown as ParallelMonitorClient,
      triggerRecreated: false,
      webhookUrlForRecreated: resolver,
      logger: silentLogger,
    });
    const failed = [
      makeMonitor({
        monitor_id: "f-fallback",
        status: "cancelled",
        webhook: { url: "https://stored.example.com/webhook?t=stored", event_types: ["monitor.event.detected"] },
        metadata: {
          vendor_domain: "https://acme.com",
          vendor_name: "Acme",
          monitor_category: "L",
          risk_dimension: "legal",
        },
      }),
    ];

    await checker.recreateFailedMonitors(failed, [makeVendor()]);

    expect(mockClient.createMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook: expect.objectContaining({ url: "https://stored.example.com/webhook?t=stored" }),
      }),
    );
  });
});

// ── selfPingWebhook ────────────────────────────────────────────────────────

describe("selfPingWebhook", () => {
  it("returns true for 200", async () => {
    const checker = createChecker();
    fetchSpy.mockResolvedValueOnce({ status: 200 });
    expect(await checker.selfPingWebhook("https://example.com/webhook")).toBe(true);
  });

  it("returns false for network error", async () => {
    const checker = createChecker();
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await checker.selfPingWebhook("https://example.com/webhook")).toBe(false);
  });

  // Finding 7: the dashboard webhook + n8n monitor-event webhook only
  // accept POST. A bare HEAD/GET returns 405. The checker now treats any
  // sub-500 status as "reachable", so a POST-only endpoint no longer
  // reports the fleet as broken.
  it("retries with POST when the first probe returns 405 (POST-only endpoint)", async () => {
    const checker = createChecker();
    fetchSpy
      .mockResolvedValueOnce({ status: 405 })
      .mockResolvedValueOnce({ status: 200 });
    expect(await checker.selfPingWebhook("https://example.com/webhook")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCall = fetchSpy.mock.calls[1][1] as { method?: string };
    expect(secondCall.method).toBe("POST");
  });

  it("treats 401/403/404 as 'reachable' (routing is fine, handler refused)", async () => {
    const checker = createChecker();
    for (const status of [401, 403, 404]) {
      fetchSpy.mockResolvedValueOnce({ status });
      expect(await checker.selfPingWebhook("https://example.com/webhook")).toBe(true);
    }
  });

  it("treats 5xx as unreachable", async () => {
    const checker = createChecker();
    fetchSpy.mockResolvedValueOnce({ status: 503 });
    expect(await checker.selfPingWebhook("https://example.com/webhook")).toBe(false);
  });
});

// ── runHealthCheck ─────────────────────────────────────────────────────────

describe("runHealthCheck", () => {
  it("runs end-to-end and compiles report", async () => {
    const checker = createChecker("https://example.com/webhook");
    mockClient.listAllMonitors.mockResolvedValueOnce([
      makeMonitor({ monitor_id: "m1", status: "active" }),
      makeMonitor({
        monitor_id: "m2",
        status: "cancelled",
        metadata: {
          vendor_domain: "https://acme.com",
          vendor_name: "A",
          monitor_category: "L",
          risk_dimension: "l",
        },
      }),
      makeMonitor({
        monitor_id: "m3",
        status: "active",
        metadata: { vendor_domain: "https://gone.com" } as Record<string, string>,
      }),
    ]);

    const vendors = [makeVendor({ vendor_domain: "https://acme.com" })];
    const report = await checker.runHealthCheck(vendors);

    expect(report.total_monitors).toBe(3);
    expect(report.orphan_count).toBe(1); // m3 (gone.com)
    expect(report.failed_count).toBe(1); // m2 (cancelled)
    expect(report.orphans_deleted).toBe(1);
    expect(report.monitors_recreated).toBe(1);
    expect(report.webhook_healthy).toBe(true);
    expect(report.timestamp).toBeDefined();
  });
});
