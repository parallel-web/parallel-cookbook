import { useMemo } from "react";
import { datacenters } from "@/data/datacenters";
import type { Datacenter, DisplayStatus } from "@/lib/types";
import { toDisplayStatus } from "@/lib/utils";

interface UseDatacentersResult {
  filtered: Datacenter[];
  /** Lifecycle counts within the current scope (all vs AI-only). */
  counts: Record<DisplayStatus | "all", number>;
  /** Total AI datacenters across the whole dataset (scope-independent). */
  aiCount: number;
  /** Total facilities across the whole dataset (scope-independent). */
  totalCount: number;
}

export function isAiFacility(dc: Datacenter): boolean {
  return !!dc.aiClassification && dc.aiClassification.ai_class !== "not-ai";
}

export function useDatacenters(
  activeFilter: DisplayStatus | "all",
  searchQuery: string,
  aiOnly = false
): UseDatacentersResult {
  return useMemo(() => {
    const counts: Record<DisplayStatus | "all", number> = {
      all: 0, operational: 0, construction: 0, planned: 0, unknown: 0, decommissioned: 0,
    };
    let aiCount = 0;
    let totalCount = 0;

    const query = searchQuery.toLowerCase().trim();

    const filtered = datacenters.filter((dc) => {
      const display = toDisplayStatus(dc.status);
      const isAi = isAiFacility(dc);

      // Scope-independent totals (drive the scope toggle)
      totalCount++;
      if (isAi) aiCount++;

      // Scope filter: AI-only excludes non-AI entirely (from counts + results)
      if (aiOnly && !isAi) return false;

      // Lifecycle counts, computed WITHIN the current scope
      counts[display]++;
      counts.all++;

      // Apply lifecycle status filter
      if (activeFilter !== "all" && display !== activeFilter) return false;

      // Apply search
      if (query) {
        const searchable = `${dc.name} ${dc.operator} ${dc.owner} ${dc.city} ${dc.state} ${dc.region}`.toLowerCase();
        if (!searchable.includes(query)) return false;
      }

      return true;
    });

    return { filtered, counts, aiCount, totalCount };
  }, [activeFilter, searchQuery, aiOnly]);
}
