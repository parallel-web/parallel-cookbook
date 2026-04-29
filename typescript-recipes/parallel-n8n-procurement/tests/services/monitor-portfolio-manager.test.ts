import { describe, it, expect, vi, beforeEach } from "vitest";
import { MonitorPortfolioManager } from "@/services/monitor-portfolio-manager.js";
import { MonitorQueryGenerator } from "@/services/monitor-query-generator.js";
import type { ParallelMonitorClient } from "@/services/parallel-monitor-client.js";
import type { Vendor } from "@/models/vendor.js";
import type { MonitorRegistryEntry } from "@/models/monitor-query.js";

// ── Helpers ────────────────────────────────────────────────────────────────

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

function makeEntry(
  overrides: Partial<MonitorRegistryEntry> = {},
): MonitorRegistryEntry {
  return {
    monitor_id: "mon_1",
    vendor_domain: "https://acme.com",
    risk_dimension: "legal",
    ...overrides,
  };
}

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

let mockCreateMonitor: ReturnType<typeof vi.fn>;
let mockDeleteMonitor: ReturnType<typeof vi.fn>;
let mockClient: ParallelMonitorClient;
let queryGenerator: MonitorQueryGenerator;

beforeEach(() => {
  vi.clearAllMocks();

  let callCount = 0;
  mockCreateMonitor = vi.fn().mockImplementation(() => {
    callCount++;
    return Promise.resolve({
      monitor_id: `mon_new_${callCount}`,
      query: "q",
      status: "active",
      cadence: "daily",
    });
  });
  mockDeleteMonitor = vi.fn().mockResolvedValue(undefined);

  mockClient = {
    createMonitor: mockCreateMonitor,
    deleteMonitor: mockDeleteMonitor,
  } as unknown as ParallelMonitorClient;

  queryGenerator = new MonitorQueryGenerator();
});

function createManager(webhook?: { url: string; event_types: string[] }) {
  return new MonitorPortfolioManager({
    monitorClient: mockClient,
    queryGenerator,
    webhook,
    logger: silentLogger,
  });
}

// ── reconcileMonitors ──────────────────────────────────────────────────────

describe("reconcileMonitors", () => {
  it("puts all new vendors into to_create", () => {
    const manager = createManager();
    const vendors = [
      makeVendor({ vendor_domain: "https://a.com" }),
      makeVendor({ vendor_domain: "https://b.com" }),
    ];
    const registered: MonitorRegistryEntry[] = [];

    const result = manager.reconcileMonitors(vendors, registered);

    expect(result.to_create).toHaveLength(2);
    expect(result.to_delete).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  it("puts all removed vendors into to_delete", () => {
    const manager = createManager();
    const vendors: Vendor[] = [];
    const registered = [
      makeEntry({ monitor_id: "mon_1", vendor_domain: "https://old.com" }),
      makeEntry({ monitor_id: "mon_2", vendor_domain: "https://old.com" }),
    ];

    const result = manager.reconcileMonitors(vendors, registered);

    expect(result.to_create).toHaveLength(0);
    expect(result.to_delete).toHaveLength(1);
    expect(result.to_delete[0].vendor_domain).toBe("https://old.com");
    expect(result.to_delete[0].monitor_ids).toEqual(["mon_1", "mon_2"]);
    expect(result.unchanged).toHaveLength(0);
  });

  it("handles mix of new, removed, and unchanged", () => {
    const manager = createManager();
    const vendors = [
      makeVendor({ vendor_domain: "https://new.com", vendor_name: "New" }),
      makeVendor({ vendor_domain: "https://stable.com", vendor_name: "Stable" }),
    ];
    const registered = [
      makeEntry({ monitor_id: "mon_1", vendor_domain: "https://stable.com" }),
      makeEntry({ monitor_id: "mon_2", vendor_domain: "https://gone.com" }),
    ];

    const result = manager.reconcileMonitors(vendors, registered);

    expect(result.to_create).toHaveLength(1);
    expect(result.to_create[0].vendor.vendor_domain).toBe("https://new.com");

    expect(result.to_delete).toHaveLength(1);
    expect(result.to_delete[0].vendor_domain).toBe("https://gone.com");

    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0].vendor_domain).toBe("https://stable.com");
  });

  it("excludes inactive vendors from to_create", () => {
    const manager = createManager();
    const vendors = [
      makeVendor({ vendor_domain: "https://active.com", active: true }),
      makeVendor({ vendor_domain: "https://inactive.com", active: false }),
    ];

    const result = manager.reconcileMonitors(vendors, []);

    expect(result.to_create).toHaveLength(1);
    expect(result.to_create[0].vendor.vendor_domain).toBe("https://active.com");
  });

  it("returns empty results for empty inputs", () => {
    const manager = createManager();

    const result = manager.reconcileMonitors([], []);

    expect(result.to_create).toHaveLength(0);
    expect(result.to_delete).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  it("attaches generated queries to each to_create entry", () => {
    const manager = createManager();
    const vendors = [makeVendor({ monitoring_priority: "medium" })];

    const result = manager.reconcileMonitors(vendors, []);

    expect(result.to_create[0].queries).toHaveLength(3); // medium = legal, cyber, financial
  });

  it("groups multiple monitors for same vendor_domain in to_delete", () => {
    const manager = createManager();
    const registered = [
      makeEntry({ monitor_id: "mon_1", vendor_domain: "https://old.com", risk_dimension: "legal" }),
      makeEntry({ monitor_id: "mon_2", vendor_domain: "https://old.com", risk_dimension: "cyber" }),
      makeEntry({ monitor_id: "mon_3", vendor_domain: "https://old.com", risk_dimension: "financial" }),
    ];

    const result = manager.reconcileMonitors([], registered);

    expect(result.to_delete).toHaveLength(1);
    expect(result.to_delete[0].monitor_ids).toEqual(["mon_1", "mon_2", "mon_3"]);
  });
});

// ── deployMonitors ─────────────────────────────────────────────────────────

describe("deployMonitors", () => {
  it("creates 5 monitors for a high priority vendor", async () => {
    const manager = createManager();
    const vendors = [makeVendor({ monitoring_priority: "high" })];

    const result = await manager.deployMonitors(vendors);

    expect(mockCreateMonitor).toHaveBeenCalledTimes(5);
    expect(result.get("https://acme.com")).toHaveLength(5);
  });

  it("creates 2 monitors for a low priority vendor", async () => {
    const manager = createManager();
    const vendors = [makeVendor({ monitoring_priority: "low" })];

    const result = await manager.deployMonitors(vendors);

    expect(mockCreateMonitor).toHaveBeenCalledTimes(2);
    expect(result.get("https://acme.com")).toHaveLength(2);
  });

  it("passes correct metadata to createMonitor", async () => {
    const manager = createManager();
    const vendors = [
      makeVendor({
        vendor_name: "TestCo",
        vendor_domain: "https://testco.com",
        monitoring_priority: "low",
      }),
    ];

    await manager.deployMonitors(vendors);

    // First call should be legal
    expect(mockCreateMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          vendor_name: "TestCo",
          vendor_domain: "https://testco.com",
          monitor_category: "Legal & Regulatory",
          risk_dimension: "legal",
        }),
      }),
    );
  });

  it("passes webhook when configured", async () => {
    const webhook = {
      url: "https://example.com/hook",
      event_types: ["monitor.event.detected"],
    };
    const manager = createManager(webhook);

    await manager.deployMonitors([makeVendor({ monitoring_priority: "low" })]);

    expect(mockCreateMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ webhook }),
    );
  });

  it("passes output_schema to createMonitor", async () => {
    const manager = createManager();

    await manager.deployMonitors([makeVendor({ monitoring_priority: "low" })]);

    expect(mockCreateMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        output_schema: expect.objectContaining({
          type: "json",
          json_schema: expect.objectContaining({
            properties: expect.objectContaining({
              event_summary: { type: "string" },
              severity: expect.objectContaining({ type: "string" }),
              adverse: { type: "boolean" },
              event_type: { type: "string" },
            }),
          }),
        }),
      }),
    );
  });

  it("returns correct domain-to-ids mapping for multiple vendors", async () => {
    const manager = createManager();
    const vendors = [
      makeVendor({ vendor_domain: "https://a.com", monitoring_priority: "low" }),
      makeVendor({ vendor_domain: "https://b.com", monitoring_priority: "low" }),
    ];

    const result = await manager.deployMonitors(vendors);

    expect(result.get("https://a.com")).toHaveLength(2);
    expect(result.get("https://b.com")).toHaveLength(2);
    expect(result.size).toBe(2);
  });
});

// ── removeMonitors ─────────────────────────────────────────────────────────

describe("removeMonitors", () => {
  it("calls deleteMonitor for each ID", async () => {
    const manager = createManager();

    await manager.removeMonitors(["mon_1", "mon_2", "mon_3"]);

    expect(mockDeleteMonitor).toHaveBeenCalledTimes(3);
    expect(mockDeleteMonitor).toHaveBeenCalledWith("mon_1");
    expect(mockDeleteMonitor).toHaveBeenCalledWith("mon_2");
    expect(mockDeleteMonitor).toHaveBeenCalledWith("mon_3");
  });

  it("handles empty array", async () => {
    const manager = createManager();

    await manager.removeMonitors([]);

    expect(mockDeleteMonitor).not.toHaveBeenCalled();
  });
});

// ── applyReconciliation ────────────────────────────────────────────────────

describe("applyReconciliation", () => {
  it("creates and deletes monitors as specified", async () => {
    const manager = createManager();
    const reconcileResult = {
      to_create: [
        {
          vendor: makeVendor({ monitoring_priority: "low" }),
          queries: queryGenerator.generateQueries(
            makeVendor({ monitoring_priority: "low" }),
          ),
        },
      ],
      to_delete: [
        { vendor_domain: "https://old.com", monitor_ids: ["mon_old_1", "mon_old_2"] },
      ],
      unchanged: [{ vendor_domain: "https://stable.com" }],
    };

    const result = await manager.applyReconciliation(reconcileResult);

    // 2 monitors created (low priority = legal + financial)
    expect(mockCreateMonitor).toHaveBeenCalledTimes(2);
    expect(result.created.get("https://acme.com")).toHaveLength(2);

    // 2 monitors deleted
    expect(mockDeleteMonitor).toHaveBeenCalledTimes(2);
    expect(result.deleted).toEqual(["mon_old_1", "mon_old_2"]);
  });

  it("handles empty reconciliation", async () => {
    const manager = createManager();

    const result = await manager.applyReconciliation({
      to_create: [],
      to_delete: [],
      unchanged: [],
    });

    expect(mockCreateMonitor).not.toHaveBeenCalled();
    expect(mockDeleteMonitor).not.toHaveBeenCalled();
    expect(result.created.size).toBe(0);
    expect(result.deleted).toEqual([]);
  });
});
