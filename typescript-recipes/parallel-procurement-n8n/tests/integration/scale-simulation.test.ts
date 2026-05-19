import { describe, it, expect } from "vitest";
import { BatchPlanner } from "@/services/batch-planner.js";
import { MonitorQueryGenerator } from "@/services/monitor-query-generator.js";
import type { Vendor } from "@/models/vendor.js";

function makeVendor(
  index: number,
  priority: "high" | "medium" | "low" = "high",
  nextResearchDate?: string,
): Vendor {
  return {
    vendor_name: `Vendor ${index}`,
    vendor_domain: `https://vendor${index}.com`,
    vendor_category: "technology",
    monitoring_priority: priority,
    active: true,
    next_research_date: nextResearchDate,
  };
}

const batchPlanner = new BatchPlanner();
const queryGenerator = new MonitorQueryGenerator();

describe("Scale Simulation", () => {
  // ── 200 Vendors → 4 Batches ──────────────────────────────────────────

  describe("200 vendors batching", () => {
    it("produces 4 batches of 50", () => {
      const vendors = Array.from({ length: 200 }, (_, i) => makeVendor(i));
      const batches = batchPlanner.planBatches(vendors, 50);

      expect(batches).toHaveLength(4);
      expect(batches[0].vendors).toHaveLength(50);
      expect(batches[1].vendors).toHaveLength(50);
      expect(batches[2].vendors).toHaveLength(50);
      expect(batches[3].vendors).toHaveLength(50);
    });
  });

  // ── 3000 Vendors with 15-Day Rotation ────────────────────────────────

  describe("3000 vendors with 15-day rotation", () => {
    it("~200 vendors are due per day", () => {
      // Distribute 3000 vendors across 15 days
      const vendors: Vendor[] = [];
      for (let i = 0; i < 3000; i++) {
        const dayOffset = i % 15; // 0-14
        const date = new Date("2026-03-01");
        date.setDate(date.getDate() + dayOffset);
        vendors.push(makeVendor(i, "high", date.toISOString()));
      }

      // Check how many are due on day 5 (2026-03-06)
      const due = batchPlanner.getVendorsDueForResearch(vendors, "2026-03-06");
      // Days 0-6 should be due (7 days × 200 per day = 1400)
      // But specifically, vendors with dates on day 0-6 (March 1-7)
      // Each day has 3000/15 = 200 vendors
      // Due = days 0 through 5 = 6 days × 200 = 1200
      expect(due.length).toBe(1200);

      // On just day 0 (March 1), exactly 200 should be due
      const dueDay0 = batchPlanner.getVendorsDueForResearch(vendors, "2026-03-01");
      expect(dueDay0.length).toBe(200); // Only day 0 vendors
    });

    it("daily batch of 200 produces 4 batches of 50", () => {
      const dailyVendors = Array.from({ length: 200 }, (_, i) => makeVendor(i));
      const batches = batchPlanner.planBatches(dailyVendors, 50);
      expect(batches).toHaveLength(4);
    });
  });

  // ── Monitor Count Calculations ───────────────────────────────────────

  describe("monitor count calculations", () => {
    it("200 high-priority vendors × 5 monitors = 1000", () => {
      const vendors = Array.from({ length: 200 }, (_, i) => makeVendor(i, "high"));
      let totalMonitors = 0;
      for (const v of vendors) {
        totalMonitors += queryGenerator.generateQueries(v).length;
      }
      expect(totalMonitors).toBe(1000);
    });

    it("mixed priorities: 100 high + 50 medium + 50 low = 750 monitors", () => {
      const high = Array.from({ length: 100 }, (_, i) => makeVendor(i, "high"));
      const medium = Array.from({ length: 50 }, (_, i) => makeVendor(100 + i, "medium"));
      const low = Array.from({ length: 50 }, (_, i) => makeVendor(150 + i, "low"));

      let total = 0;
      for (const v of [...high, ...medium, ...low]) {
        total += queryGenerator.generateQueries(v).length;
      }

      // 100×5 + 50×3 + 50×2 = 500 + 150 + 100 = 750
      expect(total).toBe(750);
    });

    it("each high vendor gets exactly 5 distinct risk dimensions", () => {
      const vendor = makeVendor(0, "high");
      const queries = queryGenerator.generateQueries(vendor);
      const dimensions = new Set(queries.map((q) => q.risk_dimension));
      expect(dimensions.size).toBe(5);
      expect(dimensions).toEqual(new Set(["legal", "cyber", "financial", "leadership", "esg"]));
    });

    it("each medium vendor gets exactly 3 dimensions", () => {
      const vendor = makeVendor(0, "medium");
      const queries = queryGenerator.generateQueries(vendor);
      const dimensions = new Set(queries.map((q) => q.risk_dimension));
      expect(dimensions.size).toBe(3);
      expect(dimensions).toEqual(new Set(["legal", "cyber", "financial"]));
    });

    it("each low vendor gets exactly 2 dimensions", () => {
      const vendor = makeVendor(0, "low");
      const queries = queryGenerator.generateQueries(vendor);
      const dimensions = new Set(queries.map((q) => q.risk_dimension));
      expect(dimensions.size).toBe(2);
      expect(dimensions).toEqual(new Set(["legal", "financial"]));
    });
  });

  // ── Large Batch Splitting ────────────────────────────────────────────

  describe("large batch edge cases", () => {
    it("1000 vendors → 20 batches", () => {
      const vendors = Array.from({ length: 1000 }, (_, i) => makeVendor(i));
      const batches = batchPlanner.planBatches(vendors, 50);
      expect(batches).toHaveLength(20);
    });

    it("batch indices are sequential", () => {
      const vendors = Array.from({ length: 250 }, (_, i) => makeVendor(i));
      const batches = batchPlanner.planBatches(vendors, 50);
      expect(batches.map((b) => b.batch_index)).toEqual([0, 1, 2, 3, 4]);
    });

    it("remainder batch is correctly sized", () => {
      const vendors = Array.from({ length: 237 }, (_, i) => makeVendor(i));
      const batches = batchPlanner.planBatches(vendors, 50);
      expect(batches).toHaveLength(5);
      expect(batches[4].vendors).toHaveLength(37);
    });
  });
});
