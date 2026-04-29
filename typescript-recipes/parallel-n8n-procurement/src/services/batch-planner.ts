import type { Vendor } from "../models/vendor.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface VendorBatch {
  batch_index: number;
  vendors: Vendor[];
}

// ── Batch Planner ──────────────────────────────────────────────────────────

export class BatchPlanner {
  planBatches(vendors: Vendor[], batchSize: number = 50): VendorBatch[] {
    if (vendors.length === 0) return [];

    const batches: VendorBatch[] = [];
    for (let i = 0; i < vendors.length; i += batchSize) {
      batches.push({
        batch_index: batches.length,
        vendors: vendors.slice(i, i + batchSize),
      });
    }
    return batches;
  }

  getVendorsDueForResearch(vendors: Vendor[], today: string): Vendor[] {
    const todayPrefix = today.slice(0, 10); // YYYY-MM-DD

    return vendors.filter((v) => {
      if (!v.active) return false;
      if (!v.next_research_date) return true; // never researched = always due
      return v.next_research_date.slice(0, 10) <= todayPrefix;
    });
  }

  updateNextResearchDates(
    vendors: Vendor[],
    cycleLength: number,
  ): Vendor[] {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + cycleLength);
    const nextDateStr = nextDate.toISOString();

    return vendors.map((v) => ({
      ...v,
      next_research_date: nextDateStr,
    }));
  }
}
