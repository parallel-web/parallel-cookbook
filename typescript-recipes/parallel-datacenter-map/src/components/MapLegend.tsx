"use client";

import type { DisplayStatus } from "@/lib/types";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/constants";

interface MapLegendProps {
  counts: Record<DisplayStatus | "all", number>;
}

const STATUSES: DisplayStatus[] = [
  "operational",
  "construction",
  "planned",
  "decommissioned",
];

export function MapLegend({ counts }: MapLegendProps) {
  return (
    <div className="absolute bottom-6 left-4 z-[400] bg-white/95 border border-[#E5E5E5] rounded-[4px] shadow-sm px-4 py-3 min-w-[170px] pointer-events-auto">
      <h3 className="text-[12px] font-medium text-[#1D1B16] mb-2 tracking-[0.02em]">
        Datacenter lifecycle
      </h3>
      <div className="space-y-1.5">
        {STATUSES.map((status) => (
          <div key={status} className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <StatusDot status={status} />
              <span className="text-[12px] text-[#5C5B59]">
                {STATUS_LABELS[status]}
              </span>
            </div>
            <span className="text-[12px] font-mono font-medium text-[#1D1B16] tabular-nums">
              {counts[status]}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2.5 pt-2 border-t border-[#E5E5E5] text-[8px] text-[#ADADAC] leading-[12px] max-w-[180px]">
        {counts.all.toLocaleString()} U.S. datacenter facilities.
        Source: Task API. Continuously monitoring for site updates.
      </p>
    </div>
  );
}

function StatusDot({ status }: { status: DisplayStatus }) {
  const color = STATUS_COLORS[status];

  if (status === "operational") {
    return (
      <span
        className="inline-block w-3 h-3 rounded-full"
        style={{ backgroundColor: color }}
      />
    );
  }

  if (status === "construction") {
    return (
      <span
        className="inline-block w-3 h-3 rounded-full"
        style={{ backgroundColor: color, opacity: 0.85 }}
      />
    );
  }

  if (status === "planned") {
    return (
      <span
        className="inline-block w-3 h-3 rounded-full border-[1.5px]"
        style={{ borderColor: color, backgroundColor: "transparent" }}
      />
    );
  }

  // unknown: hollow, lighter
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border-[1.5px]"
      style={{ borderColor: color, backgroundColor: "transparent" }}
    />
  );
}
