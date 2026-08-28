"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import type { Monitor, MonitorDetection } from "@/lib/types";
import { CopyCodeBlock } from "./CopyCodeBlock";
import {
  MONITOR_CATEGORY_LABELS,
  MONITOR_CATEGORY_COLORS,
  SEVERITY_COLORS,
} from "@/lib/constants";

interface MonitorCardProps {
  monitor: Monitor;
  isSelected: boolean;
  onSelect: () => void;
}

export function MonitorCard({ monitor, isSelected, onSelect }: MonitorCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showQuery, setShowQuery] = useState(false);
  const hasEvents = monitor.events.length > 0;

  const classBg =
    monitor.class === "region"
      ? "bg-[#F6F6F6] text-[#5C5B59]"
      : monitor.class === "facility"
        ? "bg-[#FCDDCF] text-[#FB631B]"
        : "bg-[#1D1B16] text-white";

  return (
    <div
      className={`border-b border-[#E5E5E5] transition-colors ${
        isSelected ? "bg-[#FCDDCF]/20" : ""
      }`}
    >
      {/* Monitor header — always visible */}
      <button
        onClick={() => {
          onSelect();
          setExpanded(!expanded);
        }}
        className="w-full px-6 py-3 flex items-start gap-3 hover:bg-[#F9F8F4]/50 transition-colors text-left"
      >
        {/* Status dot */}
        <span
          className={`shrink-0 mt-1.5 w-2 h-2 rounded-full ${
            hasEvents ? "bg-[#FB631B]" : "bg-[#E5E5E5]"
          }`}
        />

        <div className="flex-1 min-w-0">
          {/* Name + badges */}
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[13px] font-medium text-[#1D1B16] truncate">
              {monitor.name}
            </span>
            <span
              className={`shrink-0 font-mono uppercase text-[8px] tracking-[0.05em] px-1.5 py-0.5 rounded-[2px] ${classBg}`}
            >
              {monitor.class}
            </span>
            <span className="shrink-0 font-mono text-[8px] text-[#ADADAC]">
              {monitor.frequency}
            </span>
          </div>

          {/* Event count + facility count */}
          <div className="flex items-center gap-3">
            {hasEvents ? (
              <span className="font-mono text-[8px] uppercase tracking-[0.05em] text-[#FB631B]">
                {monitor.events.length} event
                {monitor.events.length !== 1 ? "s" : ""} detected
              </span>
            ) : (
              <span className="font-mono text-[8px] uppercase tracking-[0.05em] text-[#ADADAC]">
                No events yet
              </span>
            )}
            {monitor.facilityCount > 0 && (
              <span className="font-mono text-[8px] text-[#D6D6D6]">
                Covers {monitor.facilityCount} facilities
              </span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <span className="shrink-0 mt-1 text-[#ADADAC]">
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-6 pb-4">
          {/* Query text */}
          <div className="ml-5 mb-3">
            <button
              onClick={() => setShowQuery(!showQuery)}
              className="font-mono text-[8px] uppercase tracking-[0.05em] text-[#ADADAC] hover:text-[#858483] transition-colors"
            >
              {showQuery ? "Hide query" : "Show query"}
            </button>
            {showQuery && (
              <p className="mt-1 text-[13px] text-[#858483] leading-[20px] bg-[#F6F6F6] rounded-[4px] px-3 py-2 border border-[#E5E5E5]">
                {monitor.query}
              </p>
            )}
          </div>

          {/* Events */}
          {hasEvents ? (
            <div className="ml-5 space-y-2">
              {monitor.events.map((evt) => (
                <DetectionCard key={evt.eventId} detection={evt} monitor={monitor} />
              ))}
            </div>
          ) : (
            <p className="ml-5 text-[13px] text-[#ADADAC] italic">
              Monitor is active and checking every {monitor.frequency}. Events
              will appear here when signals are detected.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DetectionCard({ detection, monitor }: { detection: MonitorDetection; monitor: Monitor }) {
  const [showPayload, setShowPayload] = useState(false);
  const catLabel =
    MONITOR_CATEGORY_LABELS[detection.category] || detection.category;
  const catColor =
    MONITOR_CATEGORY_COLORS[detection.category] || "#858483";
  const sevColor = SEVERITY_COLORS[detection.severity] || "#858483";

  const validCitations = detection.citations.filter(
    (c) => c.url && c.url.startsWith("http")
  );

  return (
    <div className="bg-white border border-[#E5E5E5] rounded-[4px] px-4 py-3">
      {/* Category + severity + date */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="font-mono uppercase text-[8px] tracking-[0.05em] font-medium px-2 py-0.5 rounded-[2px] text-white"
          style={{ backgroundColor: catColor }}
        >
          {catLabel}
        </span>
        <span
          className="font-mono uppercase text-[8px] tracking-[0.05em] px-1.5 py-0.5 rounded-[2px] border"
          style={{ color: sevColor, borderColor: sevColor }}
        >
          {detection.severity}
        </span>
        <span className="font-mono text-[8px] text-[#ADADAC] ml-auto">
          {detection.eventDate}
        </span>
      </div>

      {/* Headline */}
      <h4 className="text-[13px] font-medium text-[#1D1B16] leading-[16px] mb-1">
        {detection.headline}
      </h4>

      {/* Summary */}
      <p className="text-[13px] text-[#5C5B59] leading-[20px] mb-2">
        {detection.summary}
      </p>

      {/* Affected entities */}
      {detection.affectedEntities && (
        <p className="text-[8px] font-mono uppercase tracking-[0.05em] text-[#ADADAC] mb-2">
          Affects: {detection.affectedEntities}
        </p>
      )}

      {/* Citations + payload toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        {validCitations.map((cite, i) => (
          <a
            key={i}
            href={cite.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.02em] text-[#858483] border border-[#E5E5E5] rounded-[2px] px-2 py-1 hover:border-[#FB631B] hover:text-[#FB631B] transition-colors"
          >
            {cite.title && cite.title.length > 40
              ? cite.title.slice(0, 40) + "..."
              : cite.title || "Source"}
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        ))}
        <button
          onClick={() => setShowPayload(!showPayload)}
          className={`font-mono text-[8px] uppercase tracking-[0.02em] border rounded-[2px] px-2 py-1 transition-colors ${
            showPayload
              ? "text-[#FB631B] border-[#FB631B] bg-[#FCDDCF]"
              : "text-[#ADADAC] border-[#E5E5E5] hover:border-[#D6D6D6]"
          }`}
        >
          {"{ }"} view code
        </button>
      </div>

      {/* API request */}
      {showPayload && (
        <div className="mt-2">
          <CopyCodeBlock
            label="POST /v1/monitors"
            code={`curl -X POST https://api.parallel.ai/v1/monitors \\
  -H "x-api-key: $PARALLEL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    type: "event_stream",
    frequency: monitor.frequency,
    settings: {
      query: monitor.query,
      processor: "base",
      output_schema: { type: "json", json_schema: "..." },
    },
  }, null, 2)}'`}
          />
        </div>
      )}
    </div>
  );
}
