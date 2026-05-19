import { describe, it, expect, vi, beforeEach } from "vitest";
import { VendorIngestionService } from "@/services/vendor-ingestion.js";
import type { MonitorPortfolioManager } from "@/services/monitor-portfolio-manager.js";
import type { Vendor } from "@/models/vendor.js";

const silentLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

function v(domain: string, priority: "high" | "medium" | "low" = "high", monitorIds?: string[]): Vendor {
  return {
    vendor_name: domain.replace("https://", "").replace(".com", ""),
    vendor_domain: domain,
    vendor_category: "technology",
    monitoring_priority: priority,
    active: true,
    ...(monitorIds ? { monitor_ids: monitorIds } : {}),
  };
}

describe("Vendor Lifecycle Integration", () => {
  const ingestion = new VendorIngestionService({ logger: silentLogger });
  let mockPortfolio: {
    deployMonitors: ReturnType<typeof vi.fn>;
    removeMonitors: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    let counter = 0;
    mockPortfolio = {
      deployMonitors: vi.fn().mockImplementation(async (vendors: Vendor[]) => {
        const map = new Map<string, string[]>();
        for (const vendor of vendors) {
          counter++;
          map.set(vendor.vendor_domain, [`mon_${counter}_a`, `mon_${counter}_b`]);
        }
        return map;
      }),
      removeMonitors: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("Cycle 1: initial sync — 10 added, monitors deployed", async () => {
    const incoming = Array.from({ length: 10 }, (_, i) => v(`https://v${i}.com`));
    const previous: Vendor[] = [];

    const diff = ingestion.computeDiff(incoming, previous);
    expect(diff.added).toHaveLength(10);
    expect(diff.removed).toHaveLength(0);

    const result = await ingestion.applyDiff(
      diff,
      mockPortfolio as unknown as MonitorPortfolioManager,
    );
    expect(mockPortfolio.deployMonitors).toHaveBeenCalledTimes(1);
    expect(mockPortfolio.deployMonitors).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ vendor_domain: "https://v0.com" })]),
    );
    expect(result.monitors_created.size).toBe(10);
  });

  it("Cycle 2: 2 removed, 3 added, 1 priority changed", async () => {
    // Previous state (from cycle 1)
    const previous = Array.from({ length: 10 }, (_, i) =>
      v(`https://v${i}.com`, "high", [`mon_prev_${i}`]),
    );

    // New state: remove v0, v1; add v10, v11, v12; change v2 priority low→high
    const incoming = [
      ...previous.slice(2).map((vendor, i) =>
        i === 0
          ? { ...vendor, monitoring_priority: "low" as const } // v2 changed from high to low
          : vendor,
      ),
      v("https://v10.com"),
      v("https://v11.com"),
      v("https://v12.com"),
    ];

    const diff = ingestion.computeDiff(incoming, previous);

    expect(diff.added).toHaveLength(3);
    expect(diff.added.map((a) => a.vendor_domain)).toEqual([
      "https://v10.com",
      "https://v11.com",
      "https://v12.com",
    ]);

    expect(diff.removed).toHaveLength(2);
    expect(diff.removed.map((r) => r.vendor_domain).sort()).toEqual([
      "https://v0.com",
      "https://v1.com",
    ]);

    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].vendor.vendor_domain).toBe("https://v2.com");
    expect(diff.modified[0].changes).toContain("monitoring_priority");

    expect(diff.unchanged).toHaveLength(7);

    // Apply diff
    const result = await ingestion.applyDiff(
      diff,
      mockPortfolio as unknown as MonitorPortfolioManager,
    );

    // Verify: monitors created for 3 new + 1 adjusted = deployMonitors called for added + modified
    expect(mockPortfolio.deployMonitors).toHaveBeenCalled();

    // Verify: monitors deleted for 2 removed + 1 modified (old monitors)
    expect(mockPortfolio.removeMonitors).toHaveBeenCalled();
    expect(result.monitors_deleted).toContain("mon_prev_0"); // v0 removed
    expect(result.monitors_deleted).toContain("mon_prev_1"); // v1 removed
    expect(result.monitors_deleted).toContain("mon_prev_2"); // v2 adjusted

    expect(result.monitors_adjusted).toContain("https://v2.com");
  });

  it("Cycle 3: no changes — no monitor API calls", async () => {
    const state = Array.from({ length: 8 }, (_, i) =>
      v(`https://v${i + 2}.com`, "high", [`mon_${i}`]),
    );

    const diff = ingestion.computeDiff(state, state);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(8);

    const result = await ingestion.applyDiff(
      diff,
      mockPortfolio as unknown as MonitorPortfolioManager,
    );

    expect(mockPortfolio.deployMonitors).not.toHaveBeenCalled();
    expect(mockPortfolio.removeMonitors).not.toHaveBeenCalled();
    expect(result.monitors_created.size).toBe(0);
    expect(result.monitors_deleted).toHaveLength(0);
  });
});
