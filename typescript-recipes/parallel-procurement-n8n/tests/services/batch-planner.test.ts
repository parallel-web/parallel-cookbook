import { describe, it, expect, vi, afterEach } from "vitest";
import { BatchPlanner } from "@/services/batch-planner.js";
import type { Vendor } from "@/models/vendor.js";

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

function makeVendors(count: number): Vendor[] {
  return Array.from({ length: count }, (_, i) =>
    makeVendor({
      vendor_name: `Vendor ${i}`,
      vendor_domain: `https://vendor${i}.com`,
    }),
  );
}

describe("BatchPlanner", () => {
  const planner = new BatchPlanner();

  // ── planBatches ────────────────────────────────────────────────────────

  describe("planBatches", () => {
    it("returns empty array for empty list", () => {
      const batches = planner.planBatches([]);
      expect(batches).toEqual([]);
    });

    it("returns 1 batch when list is smaller than batch size", () => {
      const vendors = makeVendors(3);
      const batches = planner.planBatches(vendors, 50);

      expect(batches).toHaveLength(1);
      expect(batches[0].batch_index).toBe(0);
      expect(batches[0].vendors).toHaveLength(3);
    });

    it("returns exact number of batches for exact multiple", () => {
      const vendors = makeVendors(100);
      const batches = planner.planBatches(vendors, 50);

      expect(batches).toHaveLength(2);
      expect(batches[0].vendors).toHaveLength(50);
      expect(batches[1].vendors).toHaveLength(50);
    });

    it("handles remainder correctly", () => {
      const vendors = makeVendors(125);
      const batches = planner.planBatches(vendors, 50);

      expect(batches).toHaveLength(3);
      expect(batches[0].vendors).toHaveLength(50);
      expect(batches[1].vendors).toHaveLength(50);
      expect(batches[2].vendors).toHaveLength(25);
    });

    it("assigns correct batch_index values", () => {
      const vendors = makeVendors(150);
      const batches = planner.planBatches(vendors, 50);

      expect(batches.map((b) => b.batch_index)).toEqual([0, 1, 2]);
    });

    it("uses default batch size of 50", () => {
      const vendors = makeVendors(75);
      const batches = planner.planBatches(vendors);

      expect(batches).toHaveLength(2);
      expect(batches[0].vendors).toHaveLength(50);
      expect(batches[1].vendors).toHaveLength(25);
    });

    it("handles single vendor", () => {
      const batches = planner.planBatches([makeVendor()]);
      expect(batches).toHaveLength(1);
      expect(batches[0].vendors).toHaveLength(1);
    });

    it("handles batch size of 1", () => {
      const vendors = makeVendors(3);
      const batches = planner.planBatches(vendors, 1);

      expect(batches).toHaveLength(3);
      for (const b of batches) {
        expect(b.vendors).toHaveLength(1);
      }
    });
  });

  // ── getVendorsDueForResearch ───────────────────────────────────────────

  describe("getVendorsDueForResearch", () => {
    it("includes vendor with past next_research_date", () => {
      const vendors = [
        makeVendor({ next_research_date: "2026-03-01T00:00:00.000Z" }),
      ];
      const due = planner.getVendorsDueForResearch(vendors, "2026-03-05");
      expect(due).toHaveLength(1);
    });

    it("includes vendor with today's next_research_date", () => {
      const vendors = [
        makeVendor({ next_research_date: "2026-03-05T00:00:00.000Z" }),
      ];
      const due = planner.getVendorsDueForResearch(vendors, "2026-03-05");
      expect(due).toHaveLength(1);
    });

    it("excludes vendor with future next_research_date", () => {
      const vendors = [
        makeVendor({ next_research_date: "2026-03-10T00:00:00.000Z" }),
      ];
      const due = planner.getVendorsDueForResearch(vendors, "2026-03-05");
      expect(due).toHaveLength(0);
    });

    it("includes vendor with no next_research_date (never researched)", () => {
      const vendors = [makeVendor({ next_research_date: undefined })];
      const due = planner.getVendorsDueForResearch(vendors, "2026-03-05");
      expect(due).toHaveLength(1);
    });

    it("excludes inactive vendors", () => {
      const vendors = [
        makeVendor({ active: false, next_research_date: "2026-03-01T00:00:00.000Z" }),
      ];
      const due = planner.getVendorsDueForResearch(vendors, "2026-03-05");
      expect(due).toHaveLength(0);
    });

    it("filters correctly with mixed vendors", () => {
      const vendors = [
        makeVendor({ vendor_name: "Past", next_research_date: "2026-03-01T00:00:00.000Z" }),
        makeVendor({ vendor_name: "Future", next_research_date: "2026-03-10T00:00:00.000Z" }),
        makeVendor({ vendor_name: "NeverResearched", next_research_date: undefined }),
        makeVendor({ vendor_name: "Inactive", active: false }),
      ];
      const due = planner.getVendorsDueForResearch(vendors, "2026-03-05");

      expect(due).toHaveLength(2);
      expect(due.map((v) => v.vendor_name)).toEqual(["Past", "NeverResearched"]);
    });
  });

  // ── updateNextResearchDates ────────────────────────────────────────────

  describe("updateNextResearchDates", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function expectedDate(cycleDays: number): string {
      const d = new Date();
      d.setDate(d.getDate() + cycleDays);
      return d.toISOString();
    }

    it("advances dates by cycle length", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));

      const vendors = [makeVendor()];
      const updated = planner.updateNextResearchDates(vendors, 7);

      expect(updated[0].next_research_date).toBe(expectedDate(7));
    });

    it("returns new array without mutating original", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));

      const vendors = [makeVendor({ next_research_date: "2026-03-01T00:00:00.000Z" })];
      const updated = planner.updateNextResearchDates(vendors, 14);

      expect(updated).not.toBe(vendors);
      expect(vendors[0].next_research_date).toBe("2026-03-01T00:00:00.000Z");
      expect(updated[0].next_research_date).toBe(expectedDate(14));
    });

    it("sets same date for all vendors in batch", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));

      const vendors = makeVendors(3);
      const updated = planner.updateNextResearchDates(vendors, 30);

      const dates = updated.map((v) => v.next_research_date);
      expect(new Set(dates).size).toBe(1);
      expect(dates[0]).toBe(expectedDate(30));
    });

    it("preserves other vendor fields", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));

      const vendors = [
        makeVendor({
          vendor_name: "TestCo",
          monitoring_priority: "medium",
          monitor_ids: ["mon_1"],
        }),
      ];
      const updated = planner.updateNextResearchDates(vendors, 7);

      expect(updated[0].vendor_name).toBe("TestCo");
      expect(updated[0].monitoring_priority).toBe("medium");
      expect(updated[0].monitor_ids).toEqual(["mon_1"]);
    });
  });
});
