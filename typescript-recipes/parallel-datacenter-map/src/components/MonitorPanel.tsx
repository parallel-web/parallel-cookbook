"use client";

import { useState, useMemo } from "react";
import clsx from "clsx";
import { ExternalLink, Crosshair, Mail } from "lucide-react";
import type { Monitor, MonitorDetection } from "@/lib/types";
import {
  MONITOR_CATEGORY_LABELS,
  MONITOR_CATEGORY_COLORS,
  SEVERITY_COLORS,
  REGION_CENTROIDS,
} from "@/lib/constants";
import { relativeDate } from "@/lib/utils";

type BreakdownDim = "time" | "category" | "severity";

interface MonitorPanelProps {
  monitors: Monitor[];
  selectedMonitorId: string | null;
  onSelectMonitor: (monitor: Monitor | null) => void;
  onLocateEvent?: (lat: number, lng: number) => void;
  onOpenBrief?: () => void;
}

export function MonitorPanel({
  monitors,
  selectedMonitorId,
  onSelectMonitor,
  onLocateEvent,
  onOpenBrief,
}: MonitorPanelProps) {
  const [breakdown, setBreakdown] = useState<BreakdownDim>("category");
  const [filterBucket, setFilterBucket] = useState<string | null>(null);

  // Flatten all events
  const allEvents = useMemo(() => {
    const events: { event: MonitorDetection; monitor: Monitor }[] = [];
    for (const m of monitors) {
      for (const e of m.events) events.push({ event: e, monitor: m });
    }
    events.sort((a, b) => new Date(b.event.eventDate).getTime() - new Date(a.event.eventDate).getTime());
    return events;
  }, [monitors]);

  const totalEvents = allEvents.length;
  const criticalCount = allEvents.filter((e) => e.event.severity === "critical").length;

  // Bucket events by the current breakdown dimension
  const buckets = useMemo(() => {
    const map: Record<string, { total: number; critical: number; color: string }> = {};
    for (const { event } of allEvents) {
      let key: string;
      let color = "#FB631B";
      if (breakdown === "category") {
        key = event.category;
        color = MONITOR_CATEGORY_COLORS[event.category] || "#FB631B";
      } else if (breakdown === "severity") {
        key = event.severity;
        color = SEVERITY_COLORS[event.severity] || "#858483";
      } else {
        const d = new Date(event.eventDate);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        key = weekStart.toISOString().slice(0, 10);
      }
      if (!map[key]) map[key] = { total: 0, critical: 0, color };
      map[key].total++;
      if (event.severity === "critical") map[key].critical++;
    }
    return Object.entries(map)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => breakdown === "time" ? a.key.localeCompare(b.key) : b.total - a.total);
  }, [allEvents, breakdown]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    if (!filterBucket) return allEvents;
    return allEvents.filter(({ event }) => {
      if (breakdown === "category") return event.category === filterBucket;
      if (breakdown === "severity") return event.severity === filterBucket;
      const d = new Date(event.eventDate);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      return weekStart.toISOString().slice(0, 10) === filterBucket;
    });
  }, [allEvents, filterBucket, breakdown]);

  const maxBucket = Math.max(...buckets.map((b) => b.total), 1);
  const filterLabel = filterBucket
    ? breakdown === "category" ? (MONITOR_CATEGORY_LABELS[filterBucket as keyof typeof MONITOR_CATEGORY_LABELS] || filterBucket) : filterBucket
    : null;

  function handleLocate(monitor: Monitor) {
    const centroid = REGION_CENTROIDS[monitor.id];
    if (centroid && onLocateEvent) onLocateEvent(centroid[0], centroid[1]);
  }

  return (
    <div className="flex flex-col h-full border-l border-[#E5E5E5] bg-white">
      {/* Header */}
      <div className="px-[18px] py-[14px] border-b border-[#E5E5E5] shrink-0">
        <div className="flex items-center justify-between mb-[6px]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#FB631B]" style={{ animation: "pulse-dot 2s ease-in-out infinite" }} />
            <span className="text-[13px] font-medium text-[#181818] tracking-[0.02em]">MONITORS</span>
          </div>
          <span className="font-mono uppercase text-[10.4px] tracking-[0.06em] text-[#A6A5A4]">
            {monitors.length} active &middot; {totalEvents} detected
          </span>
        </div>
        <p className="m-0 font-mono text-[13px] leading-[18px] text-[#181818]">
          <span className="font-medium">{totalEvents} events this week</span>
          {criticalCount > 0 && <> &middot; <span className="text-[#E14942]">{criticalCount} critical</span></>}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Pivot chart block */}
        <div className="px-[18px] py-[14px] border-b border-[#E5E5E5]">
          <div className="flex items-center justify-between mb-[14px]">
            <span className="font-mono uppercase text-[10.4px] tracking-[0.06em] text-[#A6A5A4]">Break down by</span>
            <div className="flex gap-[4px]">
              {(["time", "category", "severity"] as const).map((dim) => (
                <button key={dim} onClick={() => { setBreakdown(dim); setFilterBucket(null); }}
                  className={clsx("font-mono text-[8px] uppercase tracking-[0.05em] px-[9px] py-[4px] rounded-[2px] transition-colors whitespace-nowrap",
                    breakdown === dim ? "bg-[#181818] text-white" : "text-[#858483] hover:bg-[#F6F6F6] hover:text-[#181818]"
                  )}>{dim}</button>
              ))}
            </div>
          </div>

          {breakdown === "time" ? (
            <div>
              <div className="flex items-end gap-[5px] h-[84px] border-b border-[#E5E5E5]">
                {buckets.map((b) => {
                  const totalH = (b.total / maxBucket) * 100;
                  const critH = (b.critical / maxBucket) * 100;
                  const restH = totalH - critH;
                  const isActive = filterBucket === b.key;
                  return (
                    <div key={b.key} onClick={() => setFilterBucket(filterBucket === b.key ? null : b.key)}
                      className={clsx("flex-1 flex flex-col justify-end h-full cursor-pointer rounded-t-[2px] transition-opacity", !isActive && filterBucket ? "opacity-40" : "")}>
                      {critH > 0 && <span className="rounded-t-[1px]" style={{ height: `${critH}%`, background: "#E14942" }} />}
                      <span style={{ height: `${restH}%`, background: "#FB631B" }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-[6px]">
                {buckets.length > 0 && <span className="font-mono text-[8px] text-[#A6A5A4]">{buckets[0].key.slice(5)}</span>}
                {buckets.length > 1 && <span className="font-mono text-[8px] text-[#A6A5A4]">{buckets[buckets.length - 1].key.slice(5)}</span>}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-[3px]">
              {buckets.slice(0, 12).map((b, i) => {
                const pct = (b.total / maxBucket) * 100;
                const isActive = filterBucket === b.key;
                const label = breakdown === "category" ? (MONITOR_CATEGORY_LABELS[b.key as keyof typeof MONITOR_CATEGORY_LABELS] || b.key) : b.key;
                return (
                  <div key={b.key} onClick={() => setFilterBucket(filterBucket === b.key ? null : b.key)}
                    className={clsx("flex items-center gap-[8px] py-[3px] px-[6px] rounded-[2px] cursor-pointer transition-colors",
                      isActive ? "bg-[#FCDDCF55]" : "hover:bg-[#FAF8F4]", i === 0 && !filterBucket ? "bg-[#FCDDCF55]" : ""
                    )} style={isActive ? { borderLeft: "2px solid #FB631B", paddingLeft: 4 } : {}}>
                    <span className="font-mono text-[10.5px] text-[#181818] w-[120px] truncate shrink-0">{label}</span>
                    <div className="flex-1 h-[13px] bg-[#F2EFEA] rounded-[2px] overflow-hidden">
                      <div className="h-full rounded-[2px]" style={{ width: `${pct}%`, background: b.color }} />
                    </div>
                    <span className="font-mono text-[10.5px] text-[#181818] w-[24px] text-right shrink-0">{b.total}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between mt-[10px]">
            <div className="flex gap-[13px]">
              <span className="flex items-center gap-[5px]"><span className="w-2 h-2 bg-[#FB631B] rounded-[1px]" /><span className="font-mono text-[8.5px] text-[#858483]">All events</span></span>
              <span className="flex items-center gap-[5px]"><span className="w-2 h-2 bg-[#E14942] rounded-[1px]" /><span className="font-mono text-[8.5px] text-[#858483]">Critical</span></span>
            </div>
            <span className="font-mono text-[9px] text-[#A6A5A4]">Click a bar to filter ↓</span>
          </div>
        </div>

        {/* Active filter */}
        {filterBucket && (
          <div className="flex items-center gap-[7px] flex-wrap px-[18px] py-[11px] border-b border-[#E5E5E5] bg-[#FCFBFA]">
            <span className="font-mono uppercase text-[8px] tracking-[0.06em] text-[#A6A5A4]">Filtered to</span>
            <span className="inline-flex items-center gap-[5px] font-mono text-[10px] text-[#FB631B] border border-[#FB631B] rounded-[2px] px-2 py-[4px] cursor-pointer whitespace-nowrap" onClick={() => setFilterBucket(null)}>
              {filterLabel} <span className="text-[12px] leading-[1]">×</span>
            </span>
            <span className="font-mono text-[9px] text-[#A6A5A4] ml-auto">{filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}</span>
          </div>
        )}

        {/* Feed */}
        <div className="px-[18px] py-[11px] pb-[7px]">
          <span className="font-mono uppercase text-[10.4px] tracking-[0.06em] text-[#A6A5A4]">
            {filterBucket ? `${filterLabel} · ${filteredEvents.length} event${filteredEvents.length !== 1 ? "s" : ""}` : "All events · newest first"}
          </span>
        </div>
        {filteredEvents.slice(0, 20).map(({ event, monitor }) => {
          const validCitations = event.citations.filter((c) => c.url?.startsWith("http"));
          return (
            <div key={event.eventId} className="flex gap-[10px] px-[18px] py-[11px] border-t border-[#E5E5E5] hover:bg-[#FAF8F4] transition-colors">
              <span className="w-[3px] self-stretch rounded-[2px]" style={{ background: SEVERITY_COLORS[event.severity] || "#858483" }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-[4px]">
                  <div className="flex items-center gap-[7px]">
                    <span className="font-mono uppercase text-[8px] tracking-[0.05em] font-medium px-[5px] py-[2px] rounded-[2px] text-white" style={{ background: MONITOR_CATEGORY_COLORS[event.category] || "#858483" }}>
                      {MONITOR_CATEGORY_LABELS[event.category] || event.category}
                    </span>
                    <span className="font-mono uppercase text-[9px] tracking-[0.04em] text-[#A6A5A4]">{monitor.name}</span>
                  </div>
                  <span className="font-mono text-[9px] text-[#A6A5A4] shrink-0" title={`Detected ${event.eventDate}`}>{relativeDate(event.eventDate)}</span>
                </div>
                <div className="text-[13px] font-medium leading-[17px] text-[#181818] mb-[4px]">{event.headline}</div>
                {event.severity === "critical" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenBrief?.(); }}
                    className="flex items-center gap-[5px] mb-[4px] cursor-pointer group/brief"
                    title="Open this week's brief"
                  >
                    <Mail className="w-[11px] h-[11px] text-[#FB631B]" />
                    <span className="font-mono text-[9px] text-[#FB631B] group-hover/brief:underline">In this week&apos;s brief →</span>
                  </button>
                )}
                <p className="text-[13px] text-[#5C5B59] leading-[19px] mb-[6px]">{event.summary}</p>
                {event.affectedEntities && (
                  <p className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#A6A5A4] mb-[6px]">Affects: {event.affectedEntities}</p>
                )}
                <div className="flex items-center gap-[6px] flex-wrap">
                  {validCitations.map((cite, ci) => (
                    <a key={ci} href={cite.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.02em] text-[#858483] border border-[#E5E5E5] rounded-[2px] px-2 py-1 hover:border-[#FB631B] hover:text-[#FB631B] transition-colors">
                      {cite.title && cite.title.length > 30 ? cite.title.slice(0, 30) + "..." : cite.title || "Source"}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  ))}
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleLocate(monitor); }}
                className="text-[#A6A5A4] hover:text-[#FB631B] transition-colors shrink-0 self-start mt-1" title="Locate on map">
                <Crosshair className="w-3 h-3" />
              </button>
            </div>
          );
        })}
        {filteredEvents.length > 20 && (
          <div className="px-[18px] py-[13px] border-t border-[#E5E5E5]">
            <span className="font-mono text-[10px] text-[#FB631B]">View all {filteredEvents.length} {filterLabel || ""} events →</span>
          </div>
        )}
      </div>
    </div>
  );
}
