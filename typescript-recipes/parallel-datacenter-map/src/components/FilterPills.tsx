"use client";

import clsx from "clsx";
import type { DisplayStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/constants";

type FilterKey = DisplayStatus | "all";

interface FilterPillsProps {
  active: FilterKey;
  counts: Record<FilterKey, number>;
  onChange: (filter: FilterKey) => void;
}

const FILTERS: FilterKey[] = [
  "all",
  "operational",
  "construction",
  "planned",
  "decommissioned",
];

export function FilterPills({ active, counts, onChange }: FilterPillsProps) {
  return (
    <div className="flex items-center gap-1.5">
      {FILTERS.map((key) => {
        const label =
          key === "all" ? "All" : STATUS_LABELS[key as DisplayStatus];
        const count = counts[key];
        const isActive = active === key;

        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={clsx(
              "font-mono uppercase text-[13px] leading-[16px] rounded-[2px] px-3 py-1.5 border transition-colors",
              isActive
                ? "bg-[#1D1B16] text-white border-[#1D1B16]"
                : "bg-white text-[#5C5B59] border-[#E5E5E5] hover:border-[#D6D6D6] hover:text-[#1D1B16]"
            )}
          >
            {label}{" "}
            <span className={isActive ? "text-[#858483]" : "text-[#ADADAC]"}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
