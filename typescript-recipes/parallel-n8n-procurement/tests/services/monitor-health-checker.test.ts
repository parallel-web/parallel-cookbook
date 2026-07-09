import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { MonitorHealthChecker } from "@/services/monitor-health-checker.js";
import type { ParallelMonitorClient } from "@/services/parallel-monitor-client.js";
import type { Monitor } from "@/models/monitor-api.js";
import type { Vendor } from "@/models/vendor.js";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
const mockAxiosGet = vi.mocked(axios.get);

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    monitor_id: "mon_1",
    query: "test query",
    status: "active",
    cadence: "daily",
    metadata: { vendor_name: "Acme", vendor_domain: "https://acme.com", monitor_category: "Legal", risk_dimension: "legal" },
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
  listMonitors: ReturnType<typeof vi.fn>;
  deleteMonitor: ReturnType<typeof vi.fn>;
  createMonitor: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  let createCount = 0;
  mockClient = {
    listMonitors: vi.fn().mockResolvedValue({ monitors: [] }),
    deleteMonitor: vi.fn().mockResolvedValue(undefined),
    createMonitor: vi.fn().mockImplementation(async () => {
      createCount++;
      return makeMonitor({ monitor_id: `mon_new_${createCount}` });
    }),
  };
  mockAxiosGet.mockResolvedValue({ status: 200, data: "ok" });
});

function createChecker(webhookUrl?: string) {
  return new MonitorHealthChecker({
    monitorClient: mockClient as unknown as ParallelMonitorClient,
    webhookUrl,
    logger: silentLogger,
  });
}

// ── detectOrphanedMonitors ─────────────────────────────────────────────────

describe("detectOrphanedMonitors", () => {
  it("monitor with vendor in registry → not orphan", () => {
    const checker = createChecker();
    const monitors = [makeMonitor({ metadata: { vendor_domain: "https://acme.com" } })];
    const vendors = [makeVendor({ vendor_domain: "https://acme.com" })];

    const orphans = checker.detectOrphanedMonitors(monitors, vendors);
    expect(orphans).toHaveLength(0);
  });

  it("monitor with vendor NOT in registry → orphan", () => {
    const checker = createChecker();
    const monitors = [makeMonitor({ metadata: { vendor_domain: "https://gone.com" } })];
    const vendors = [makeVendor({ vendor_domain: "https://acme.com" })];

    const orphans = checker.detectOrphanedMonitors(monitors, vendors);
    expect(orphans).toHaveLength(1);
  });

  it("monitor with no metadata → orphan", () => {
    const checker = createChecker();
    const monitors = [makeMonitor({ metadata: undefined })];

    const orphans = checker.detectOrphanedMonitors(monitors, [makeVendor()]);
    expect(orphans).toHaveLength(1);
  });

  it("inactive vendor's monitor → orphan", () => {
    const checker = createChecker();
    const monitors = [makeMonitor({ metadata: { vendor_domain: "https://acme.com" } })];
    const vendors = [makeVendor({ vendor_domain: "https://acme.com", active: false })];

    const orphans = checker.detectOrphanedMonitors(monitors, vendors);
    expect(orphans).toHaveLength(1);
  });

  it("empty monitors → empty", () => {
    const checker = createChecker();
    expect(checker.detectOrphanedMonitors([], [makeVendor()])).toEqual([]);
  });
});

// ── detectFailedMonitors ───────────────────────────────────────────────────

describe("detectFailedMonitors", () => {
  it("active monitor → not failed", () => {
    const checker = createChecker();
    expect(checker.detectFailedMonitors([makeMonitor({ status: "active" })])).toHaveLength(0);
  });

  it("canceled monitor → failed", () => {
    const checker = createChecker();
    const result = checker.detectFailedMonitors([makeMonitor({ status: "canceled" })]);
    expect(result).toHaveLength(1);
  });

  it("mixed list → correct filtering", () => {
    const checker = createChecker();
    const monitors = [
      makeMonitor({ monitor_id: "m1", status: "active" }),
      makeMonitor({ monitor_id: "m2", status: "canceled" }),
      makeMonitor({ monitor_id: "m3", status: "active" }),
    ];
    const result = checker.detectFailedMonitors(monitors);
    expect(result).toHaveLength(1);
    expect(result[0].monitor_id).toBe("m2");
  });
});

// ── cleanupOrphans ─────────────────────────────────────────────────────────

describe("cleanupOrphans", () => {
  it("deletes each orphan and returns counts", async () => {
    const checker = createChecker();
    const orphans = [makeMonitor({ monitor_id: "o1" }), makeMonitor({ monitor_id: "o2" })];

    const result = await checker.cleanupOrphans(orphans);

    expect(mockClient.deleteMonitor).toHaveBeenCalledTimes(2);
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles deletion errors", async () => {
    const checker = createChecker();
    mockClient.deleteMonitor
      .mockResolvedValueOnce(undefined)
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
  it("deletes failed and creates new with same config", async () => {
    const checker = createChecker();
    const failed = [makeMonitor({ monitor_id: "f1", metadata: { vendor_domain: "https://acme.com", vendor_name: "Acme", monitor_category: "Legal", risk_dimension: "legal" } })];
    const vendors = [makeVendor()];

    const result = await checker.recreateFailedMonitors(failed, vendors);

    expect(mockClient.deleteMonitor).toHaveBeenCalledWith("f1");
    expect(mockClient.createMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ query: "test query", cadence: "daily" }),
    );
    expect(result.recreated).toBe(1);
    expect(result.new_monitor_ids).toHaveLength(1);
  });

  it("skips if vendor not found", async () => {
    const checker = createChecker();
    const failed = [makeMonitor({ metadata: { vendor_domain: "https://unknown.com" } })];

    const result = await checker.recreateFailedMonitors(failed, [makeVendor()]);

    expect(result.recreated).toBe(0);
    expect(result.failed).toBe(1);
    expect(mockClient.createMonitor).not.toHaveBeenCalled();
  });

  it("returns new monitor IDs", async () => {
    const checker = createChecker();
    const failed = [
      makeMonitor({ monitor_id: "f1", metadata: { vendor_domain: "https://acme.com", vendor_name: "A", monitor_category: "L", risk_dimension: "l" } }),
    ];

    const result = await checker.recreateFailedMonitors(failed, [makeVendor()]);
    expect(result.new_monitor_ids[0]).toMatch(/^mon_new_/);
  });
});

// ── selfPingWebhook ────────────────────────────────────────────────────────

describe("selfPingWebhook", () => {
  it("returns true for 200", async () => {
    const checker = createChecker();
    mockAxiosGet.mockResolvedValueOnce({ status: 200, data: "ok" });

    expect(await checker.selfPingWebhook("https://example.com/webhook")).toBe(true);
  });

  it("returns false for network error", async () => {
    const checker = createChecker();
    mockAxiosGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    expect(await checker.selfPingWebhook("https://example.com/webhook")).toBe(false);
  });
});

// ── runHealthCheck ─────────────────────────────────────────────────────────

describe("runHealthCheck", () => {
  it("runs end-to-end and compiles report", async () => {
    const checker = createChecker("https://example.com/webhook");
    mockClient.listMonitors.mockResolvedValueOnce({
      monitors: [
        makeMonitor({ monitor_id: "m1", status: "active", metadata: { vendor_domain: "https://acme.com" } }),
        makeMonitor({ monitor_id: "m2", status: "canceled", metadata: { vendor_domain: "https://acme.com", vendor_name: "A", monitor_category: "L", risk_dimension: "l" } }),
        makeMonitor({ monitor_id: "m3", status: "active", metadata: { vendor_domain: "https://gone.com" } }),
      ],
    });

    const vendors = [makeVendor({ vendor_domain: "https://acme.com" })];
    const report = await checker.runHealthCheck(vendors);

    expect(report.total_monitors).toBe(3);
    expect(report.orphan_count).toBe(1);   // m3 (gone.com)
    expect(report.failed_count).toBe(1);   // m2 (canceled)
    expect(report.orphans_deleted).toBe(1);
    expect(report.monitors_recreated).toBe(1);
    expect(report.webhook_healthy).toBe(true);
    expect(report.timestamp).toBeDefined();
  });
});
