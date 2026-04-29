import { describe, it, expect, vi, beforeEach } from "vitest";
import { VendorIngestionService } from "@/services/vendor-ingestion.js";
import type { MonitorPortfolioManager } from "@/services/monitor-portfolio-manager.js";
import type { Vendor } from "@/models/vendor.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

function createService() {
  return new VendorIngestionService({ logger: silentLogger });
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

const CSV_HEADER = "vendor_name,vendor_domain,vendor_category,risk_tier_override,active,monitoring_priority";

function csvRow(
  name: string,
  domain: string,
  category: string,
  override = "",
  active = "true",
  priority = "high",
) {
  return `${name},${domain},${category},${override},${active},${priority}`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── ingestFromCSV ──────────────────────────────────────────────────────────

describe("ingestFromCSV", () => {
  it("parses valid CSV with all columns", async () => {
    const service = createService();
    const csv = [
      CSV_HEADER,
      csvRow("Acme Corp", "https://acme.com", "technology", "", "true", "high"),
    ].join("\n");

    const vendors = await service.ingestFromCSV(csv);

    expect(vendors).toHaveLength(1);
    expect(vendors[0].vendor_name).toBe("Acme Corp");
    expect(vendors[0].vendor_domain).toBe("https://acme.com");
    expect(vendors[0].vendor_category).toBe("technology");
    expect(vendors[0].monitoring_priority).toBe("high");
    expect(vendors[0].active).toBe(true);
  });

  it("handles missing optional risk_tier_override", async () => {
    const service = createService();
    const csv = [
      CSV_HEADER,
      csvRow("Acme", "https://acme.com", "technology", "", "true", "high"),
    ].join("\n");

    const vendors = await service.ingestFromCSV(csv);
    expect(vendors[0].risk_tier_override).toBeUndefined();
  });

  it("handles risk_tier_override when present", async () => {
    const service = createService();
    const csv = [
      CSV_HEADER,
      csvRow("Acme", "https://acme.com", "technology", "HIGH", "true", "high"),
    ].join("\n");

    const vendors = await service.ingestFromCSV(csv);
    expect(vendors[0].risk_tier_override).toBe("HIGH");
  });

  it("handles quoted fields with commas", async () => {
    const service = createService();
    const csv = `${CSV_HEADER}\n"Acme, Inc",https://acme.com,technology,,true,high`;

    const vendors = await service.ingestFromCSV(csv);
    expect(vendors[0].vendor_name).toBe("Acme, Inc");
  });

  it("handles BOM character", async () => {
    const service = createService();
    const csv = `\uFEFF${CSV_HEADER}\nAcme,https://acme.com,technology,,true,high`;

    const vendors = await service.ingestFromCSV(csv);
    expect(vendors).toHaveLength(1);
  });

  it("handles \\r\\n line endings", async () => {
    const service = createService();
    const csv = `${CSV_HEADER}\r\nAcme,https://acme.com,technology,,true,high`;

    const vendors = await service.ingestFromCSV(csv);
    expect(vendors).toHaveLength(1);
  });

  it("skips invalid rows and continues", async () => {
    const service = createService();
    const csv = [
      CSV_HEADER,
      csvRow("Good", "https://good.com", "technology", "", "true", "high"),
      csvRow("Bad", "https://bad.com", "invalid_category", "", "true", "high"),
      csvRow("Also Good", "https://also.com", "healthcare", "", "true", "low"),
    ].join("\n");

    const vendors = await service.ingestFromCSV(csv);
    expect(vendors).toHaveLength(2);
    expect(vendors[0].vendor_name).toBe("Good");
    expect(vendors[1].vendor_name).toBe("Also Good");
  });

  it("parses 'false' as active=false", async () => {
    const service = createService();
    const csv = [
      CSV_HEADER,
      csvRow("Acme", "https://acme.com", "technology", "", "false", "high"),
    ].join("\n");

    const vendors = await service.ingestFromCSV(csv);
    expect(vendors[0].active).toBe(false);
  });

  it("defaults empty active to true", async () => {
    const service = createService();
    const csv = [
      CSV_HEADER,
      csvRow("Acme", "https://acme.com", "technology", "", "", "high"),
    ].join("\n");

    const vendors = await service.ingestFromCSV(csv);
    expect(vendors[0].active).toBe(true);
  });

  it("prepends https:// to bare domain", async () => {
    const service = createService();
    const csv = [
      CSV_HEADER,
      csvRow("Acme", "acme.com", "technology", "", "true", "high"),
    ].join("\n");

    const vendors = await service.ingestFromCSV(csv);
    expect(vendors[0].vendor_domain).toBe("https://acme.com");
  });

  it("returns empty for header-only CSV", async () => {
    const service = createService();
    const vendors = await service.ingestFromCSV(CSV_HEADER);
    expect(vendors).toEqual([]);
  });
});

// ── deduplicateVendors ─────────────────────────────────────────────────────

describe("deduplicateVendors", () => {
  it("keeps last occurrence", () => {
    const service = createService();
    const vendors = [
      makeVendor({ vendor_name: "Old", vendor_domain: "https://acme.com" }),
      makeVendor({ vendor_name: "New", vendor_domain: "https://acme.com" }),
    ];

    const deduped = service.deduplicateVendors(vendors);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].vendor_name).toBe("New");
  });

  it("no duplicates returns same count", () => {
    const service = createService();
    const vendors = [
      makeVendor({ vendor_domain: "https://a.com" }),
      makeVendor({ vendor_domain: "https://b.com" }),
    ];

    const deduped = service.deduplicateVendors(vendors);
    expect(deduped).toHaveLength(2);
  });

  it("handles multiple duplicates", () => {
    const service = createService();
    const vendors = [
      makeVendor({ vendor_name: "V1", vendor_domain: "https://a.com" }),
      makeVendor({ vendor_name: "V2", vendor_domain: "https://a.com" }),
      makeVendor({ vendor_name: "V3", vendor_domain: "https://a.com" }),
    ];

    const deduped = service.deduplicateVendors(vendors);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].vendor_name).toBe("V3");
  });
});

// ── computeDiff ────────────────────────────────────────────────────────────

describe("computeDiff", () => {
  it("all new vendors → all in added", () => {
    const service = createService();
    const incoming = [makeVendor({ vendor_domain: "https://new.com" })];
    const previous: Vendor[] = [];

    const diff = service.computeDiff(incoming, previous);

    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it("all removed → all in removed", () => {
    const service = createService();
    const incoming: Vendor[] = [];
    const previous = [makeVendor({ vendor_domain: "https://old.com" })];

    const diff = service.computeDiff(incoming, previous);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].vendor_domain).toBe("https://old.com");
  });

  it("mix of added, removed, unchanged", () => {
    const service = createService();
    const incoming = [
      makeVendor({ vendor_domain: "https://new.com" }),
      makeVendor({ vendor_domain: "https://stable.com" }),
    ];
    const previous = [
      makeVendor({ vendor_domain: "https://stable.com" }),
      makeVendor({ vendor_domain: "https://gone.com" }),
    ];

    const diff = service.computeDiff(incoming, previous);

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].vendor_domain).toBe("https://new.com");
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].vendor_domain).toBe("https://gone.com");
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.unchanged[0].vendor_domain).toBe("https://stable.com");
  });

  it("detects modified monitoring_priority", () => {
    const service = createService();
    const incoming = [
      makeVendor({ vendor_domain: "https://acme.com", monitoring_priority: "high" }),
    ];
    const previous = [
      makeVendor({ vendor_domain: "https://acme.com", monitoring_priority: "low" }),
    ];

    const diff = service.computeDiff(incoming, previous);

    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].changes).toContain("monitoring_priority");
    expect(diff.modified[0].vendor.monitoring_priority).toBe("high");
    expect(diff.modified[0].previous.monitoring_priority).toBe("low");
  });

  it("detects modified vendor_category", () => {
    const service = createService();
    const incoming = [
      makeVendor({ vendor_domain: "https://acme.com", vendor_category: "healthcare" }),
    ];
    const previous = [
      makeVendor({ vendor_domain: "https://acme.com", vendor_category: "technology" }),
    ];

    const diff = service.computeDiff(incoming, previous);

    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].changes).toContain("vendor_category");
  });

  it("unchanged when fields match", () => {
    const service = createService();
    const vendor = makeVendor();
    const diff = service.computeDiff([vendor], [vendor]);

    expect(diff.unchanged).toHaveLength(1);
    expect(diff.modified).toHaveLength(0);
  });

  it("empty incoming + empty previous → empty diff", () => {
    const service = createService();
    const diff = service.computeDiff([], []);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });
});

// ── applyDiff ──────────────────────────────────────────────────────────────

describe("applyDiff", () => {
  let mockPortfolio: {
    deployMonitors: ReturnType<typeof vi.fn>;
    removeMonitors: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    let callCount = 0;
    mockPortfolio = {
      deployMonitors: vi.fn().mockImplementation(async (vendors: Vendor[]) => {
        const map = new Map<string, string[]>();
        for (const v of vendors) {
          callCount++;
          map.set(v.vendor_domain, [`mon_${callCount}`]);
        }
        return map;
      }),
      removeMonitors: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("deploys monitors for added vendors", async () => {
    const service = createService();
    const diff = {
      added: [makeVendor({ vendor_domain: "https://new.com" })],
      removed: [],
      unchanged: [],
      modified: [],
    };

    const result = await service.applyDiff(
      diff,
      mockPortfolio as unknown as MonitorPortfolioManager,
    );

    expect(mockPortfolio.deployMonitors).toHaveBeenCalledWith(diff.added);
    expect(result.monitors_created.get("https://new.com")).toBeDefined();
  });

  it("removes monitors for removed vendors", async () => {
    const service = createService();
    const diff = {
      added: [],
      removed: [makeVendor({ vendor_domain: "https://old.com", monitor_ids: ["mon_1", "mon_2"] })],
      unchanged: [],
      modified: [],
    };

    const result = await service.applyDiff(
      diff,
      mockPortfolio as unknown as MonitorPortfolioManager,
    );

    expect(mockPortfolio.removeMonitors).toHaveBeenCalledWith(["mon_1", "mon_2"]);
    expect(result.monitors_deleted).toEqual(["mon_1", "mon_2"]);
  });

  it("adjusts monitors for modified priority", async () => {
    const service = createService();
    const diff = {
      added: [],
      removed: [],
      unchanged: [],
      modified: [
        {
          vendor: makeVendor({ vendor_domain: "https://acme.com", monitoring_priority: "high" }),
          previous: makeVendor({
            vendor_domain: "https://acme.com",
            monitoring_priority: "low",
            monitor_ids: ["old_mon_1"],
          }),
          changes: ["monitoring_priority"],
        },
      ],
    };

    const result = await service.applyDiff(
      diff,
      mockPortfolio as unknown as MonitorPortfolioManager,
    );

    expect(mockPortfolio.removeMonitors).toHaveBeenCalledWith(["old_mon_1"]);
    expect(mockPortfolio.deployMonitors).toHaveBeenCalledWith([diff.modified[0].vendor]);
    expect(result.monitors_adjusted).toContain("https://acme.com");
  });

  it("collects errors without throwing", async () => {
    const service = createService();
    mockPortfolio.deployMonitors.mockRejectedValueOnce(new Error("API down"));

    const diff = {
      added: [makeVendor({ vendor_domain: "https://new.com" })],
      removed: [],
      unchanged: [],
      modified: [],
    };

    const result = await service.applyDiff(
      diff,
      mockPortfolio as unknown as MonitorPortfolioManager,
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].vendor_domain).toBe("https://new.com");
    expect(result.errors[0].error).toContain("API down");
  });

  it("empty diff makes no calls", async () => {
    const service = createService();
    const diff = { added: [], removed: [], unchanged: [], modified: [] };

    const result = await service.applyDiff(
      diff,
      mockPortfolio as unknown as MonitorPortfolioManager,
    );

    expect(mockPortfolio.deployMonitors).not.toHaveBeenCalled();
    expect(mockPortfolio.removeMonitors).not.toHaveBeenCalled();
    expect(result.monitors_created.size).toBe(0);
    expect(result.monitors_deleted).toHaveLength(0);
  });

  it("skips removed vendors without monitor_ids", async () => {
    const service = createService();
    const diff = {
      added: [],
      removed: [makeVendor({ vendor_domain: "https://old.com" })], // no monitor_ids
      unchanged: [],
      modified: [],
    };

    const result = await service.applyDiff(
      diff,
      mockPortfolio as unknown as MonitorPortfolioManager,
    );

    expect(mockPortfolio.removeMonitors).not.toHaveBeenCalled();
    expect(result.monitors_deleted).toHaveLength(0);
  });
});

// ── updateRegistry ─────────────────────────────────────────────────────────

describe("updateRegistry", () => {
  it("merges monitor IDs and sets last_synced_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));

    const { writeFile } = await import("node:fs/promises");
    vi.mock("node:fs/promises", () => ({
      writeFile: vi.fn().mockResolvedValue(undefined),
    }));

    const service = createService();
    const vendors = [makeVendor({ vendor_domain: "https://acme.com" })];
    const mapping = new Map([["https://acme.com", ["mon_1", "mon_2"]]]);

    await service.updateRegistry(vendors, mapping, "/tmp/test-registry.json");

    const mockedWriteFile = vi.mocked(writeFile);
    expect(mockedWriteFile).toHaveBeenCalledWith(
      "/tmp/test-registry.json",
      expect.stringContaining("mon_1"),
    );

    const written = JSON.parse(mockedWriteFile.mock.calls[0][1] as string);
    expect(written.vendors[0].monitor_ids).toEqual(["mon_1", "mon_2"]);
    expect(written.vendors[0].last_synced_at).toBeDefined();
    expect(written.total_count).toBe(1);

    vi.useRealTimers();
  });
});
