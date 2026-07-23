"use client";

import clsx from "clsx";
import type { DisplayStatus } from "@/lib/types";
import { FilterPills } from "./FilterPills";

type Tab = "map" | "dataset";
type FilterKey = DisplayStatus | "all";

interface ToolbarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  activeFilter: FilterKey;
  counts: Record<FilterKey, number>;
  onFilterChange: (filter: FilterKey) => void;
  trackedCount: number;
  aiCount: number;
  totalCount: number;
  aiOnly: boolean;
  onAiOnlyChange: (aiOnly: boolean) => void;
}

export function Toolbar({
  activeTab,
  onTabChange,
  activeFilter,
  counts,
  onFilterChange,
  trackedCount,
  aiCount,
  totalCount,
  aiOnly,
  onAiOnlyChange,
}: ToolbarProps) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-y-2 px-6 py-2 border-b border-[#E5E5E5] bg-white shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-0.5 border border-[#E5E5E5] rounded-[4px] p-0.5">
          {(["map", "dataset"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={clsx(
                "font-mono uppercase text-[13px] leading-[16px] rounded-[2px] px-3 py-1 transition-colors",
                activeTab === tab
                  ? "bg-[#1D1B16] text-white"
                  : "text-[#858483] hover:text-[#1D1B16]"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-[#858483]">
          {trackedCount.toLocaleString()} shown
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Scope: All facilities vs AI datacenters (mutually exclusive) */}
        {aiCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="font-mono uppercase text-[9px] tracking-[0.06em] text-[#A6A5A4]">Scope</span>
            <div className="flex items-center gap-0.5 border border-[#E5E5E5] rounded-[4px] p-0.5">
              <ScopeButton active={!aiOnly} onClick={() => onAiOnlyChange(false)} label="All facilities" count={totalCount} />
              <ScopeButton active={aiOnly} onClick={() => onAiOnlyChange(true)} label="AI datacenters" count={aiCount} accent />
            </div>
          </div>
        )}

        <span className="w-px h-5 bg-[#E5E5E5]" />

        {/* Lifecycle status (counts reflect current scope) */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono uppercase text-[9px] tracking-[0.06em] text-[#A6A5A4]">Lifecycle</span>
          <FilterPills active={activeFilter} counts={counts} onChange={onFilterChange} />
        </div>
      </div>
    </div>
  );
}

function ScopeButton({ active, onClick, label, count, accent }: {
  active: boolean; onClick: () => void; label: string; count: number; accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "font-mono uppercase text-[13px] leading-[16px] rounded-[2px] px-3 py-1 transition-colors whitespace-nowrap",
        active
          ? accent ? "bg-[#FB631B] text-white" : "bg-[#1D1B16] text-white"
          : "text-[#858483] hover:text-[#1D1B16]"
      )}
    >
      {label}{" "}
      <span className={active ? "text-white/70" : "text-[#ADADAC]"}>{count.toLocaleString()}</span>
    </button>
  );
}
