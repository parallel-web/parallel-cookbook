"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ExternalLink, X } from "lucide-react";
import type { Datacenter, DisplayStatus, Monitor } from "@/lib/types";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  MAP_CENTER,
  MAP_ZOOM,
  TILE_URL,
  TILE_ATTRIBUTION,
  STATE_TO_MONITOR,
  CA_SPLIT_LAT,
  AI_CLASS_LABELS,
  AI_CLASS_COLORS,
  IMPACT_LABELS,
  IMPACT_COLORS,
  PUSHBACK_LABELS,
  PUSHBACK_COLORS,
} from "@/lib/constants";
import { toDisplayStatus, formatPower, formatSqft } from "@/lib/utils";
import { MapLegend } from "./MapLegend";

interface MapPanelProps {
  datacenters: Datacenter[];
  counts: Record<DisplayStatus | "all", number>;
  selectedMonitor: Monitor | null;
  focusedLocation?: { lat: number; lng: number } | null;
}

/** Which monitor covers a given datacenter? */
function getMonitorIdForDc(dc: Datacenter): string | null {
  if (dc.state === "CA") {
    return dc.lat < CA_SPLIT_LAT ? "region-socal" : "region-norcal";
  }
  return STATE_TO_MONITOR[dc.state] || null;
}

function getMarkerStyle(
  status: DisplayStatus,
  isHighlighted: boolean,
  isDimmed: boolean
) {
  const base = {
    operational: {
      fillColor: STATUS_COLORS.operational,
      fillOpacity: 1,
      color: STATUS_COLORS.operational,
      weight: 1.5,
      radius: 4,
    },
    construction: {
      fillColor: STATUS_COLORS.construction,
      fillOpacity: 0.85,
      color: STATUS_COLORS.construction,
      weight: 1.5,
      radius: 4,
    },
    planned: {
      fillColor: STATUS_COLORS.planned,
      fillOpacity: 0.3,
      color: STATUS_COLORS.planned,
      weight: 2,
      radius: 4,
    },
    unknown: {
      fillColor: "transparent",
      fillOpacity: 0,
      color: STATUS_COLORS.unknown,
      weight: 1.5,
      radius: 4,
    },
    decommissioned: {
      fillColor: STATUS_COLORS.decommissioned,
      fillOpacity: 0.6,
      color: STATUS_COLORS.decommissioned,
      weight: 2,
      radius: 4,
    },
  }[status];

  if (isHighlighted) {
    return {
      ...base,
      fillColor: "#FB631B",
      fillOpacity: 1,
      color: "#FB631B",
      weight: 2,
      radius: 4,
    };
  }

  if (isDimmed) {
    return {
      ...base,
      fillOpacity: base.fillOpacity * 0.15,
      opacity: 0.15,
      radius: 2,
    };
  }

  return base;
}

/** Flies the map to fit highlighted facilities */
function FlyToSelection({
  datacenters,
  selectedMonitor,
}: {
  datacenters: Datacenter[];
  selectedMonitor: Monitor | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!selectedMonitor) {
      // Reset to default view
      map.flyTo(MAP_CENTER, MAP_ZOOM, { duration: 0.8 });
      return;
    }

    // Find matching facilities
    const matching = datacenters.filter((dc) => {
      if (selectedMonitor.class === "facility") {
        return (
          dc.operator?.toLowerCase().includes("qts") &&
          selectedMonitor.states?.includes(dc.state)
        );
      }
      if (selectedMonitor.states?.length) {
        const monId = getMonitorIdForDc(dc);
        return monId === selectedMonitor.id;
      }
      return false;
    });

    if (matching.length === 0) return;

    // Compute bounds
    const bounds = L.latLngBounds(matching.map((dc) => [dc.lat, dc.lng]));
    map.flyToBounds(bounds.pad(0.4), { duration: 0.8, maxZoom: 8 });
  }, [selectedMonitor, datacenters, map]);

  return null;
}

/** Flies to a specific location when triggered */
function FlyToLocation({ location }: { location: { lat: number; lng: number } | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (location) map.flyTo([location.lat, location.lng], 7, { duration: 0.8 });
  }, [location, map]);
  return null;
}

export default function MapPanel({
  datacenters,
  counts,
  selectedMonitor,
  focusedLocation,
}: MapPanelProps) {
  // Precompute which DCs are highlighted
  const highlightSet = useMemo(() => {
    if (!selectedMonitor) return null;

    const set = new Set<number>();
    datacenters.forEach((dc, i) => {
      if (selectedMonitor.class === "facility") {
        if (
          dc.operator?.toLowerCase().includes("qts") &&
          selectedMonitor.states?.includes(dc.state)
        ) {
          set.add(i);
        }
      } else if (selectedMonitor.states?.length) {
        const monId = getMonitorIdForDc(dc);
        if (monId === selectedMonitor.id) {
          set.add(i);
        }
      }
    });
    return set;
  }, [selectedMonitor, datacenters]);

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
        className="w-full h-full"
        zoomControl={true}
        attributionControl={true}
        preferCanvas={true}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <FlyToSelection
          datacenters={datacenters}
          selectedMonitor={selectedMonitor}
        />
        <FlyToLocation location={focusedLocation} />
        {datacenters.map((dc, i) => {
          const display = toDisplayStatus(dc.status);
          const isHighlighted = highlightSet?.has(i) ?? false;
          const isDimmed = highlightSet !== null && !isHighlighted;
          const style = getMarkerStyle(display, isHighlighted, isDimmed);

          return (
            <CircleMarker
              key={`${dc.lat}-${dc.lng}-${i}`}
              center={[dc.lat, dc.lng]}
              pathOptions={style}
              radius={style.radius}
            >
              <Tooltip
                direction="top"
                offset={[0, -8]}
                className="facility-tooltip"
              >
                <div className="font-sans text-[12px]">
                  <div className="font-medium text-[#1D1B16]">{dc.name}</div>
                  <div className="text-[#858483]">{dc.operator} &middot; {dc.city}, {dc.state}</div>
                </div>
              </Tooltip>
              <Popup closeButton={false} minWidth={260} maxWidth={320}>
                <FacilityPopup dc={dc} display={display} />
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <MapLegend counts={counts} />
    </div>
  );
}

function ImpactChip({
  label,
  color,
  value,
}: {
  label: string;
  color: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] leading-[14px] text-[#5C5B59] border border-[#E5E5E5] rounded-[3px] px-1.5 py-[3px]">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[#ADADAC]">{label}</span> {value}
    </span>
  );
}

function FacilityPopup({
  dc,
  display,
}: {
  dc: Datacenter;
  display: DisplayStatus;
}) {
  const map = useMap();
  const e = dc.enrichment;

  // Citations are stripped from the static bundle and loaded on demand.
  // This component only mounts when the popup actually opens (react-leaflet
  // portals children lazily), so the fetch fires once per open.
  const [citations, setCitations] = useState<{ url: string; title: string }[]>([]);
  const [loadingCites, setLoadingCites] = useState(false);

  useEffect(() => {
    if (dc.sourceIndex == null) return;
    let cancelled = false;
    setLoadingCites(true);
    fetch(`/api/basis?facility=${dc.sourceIndex}`)
      .then((r) => r.json())
      .then((d: { citations?: { url: string; title: string }[] }) => {
        if (cancelled) return;
        const list = (d.citations || []).filter((c) => c.url?.startsWith("http"));
        const unique = Array.from(new Map(list.map((c) => [c.url, c])).values());
        setCitations(unique.slice(0, 6));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingCites(false); });
    return () => { cancelled = true; };
  }, [dc.sourceIndex]);

  return (
    <div className="flex flex-col max-h-[56vh] min-w-[260px] max-w-[300px]">
      {/* Header — fixed above the scroll area so the close button is always reachable */}
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-2.5 shrink-0 border-b border-[#F1F0EC] bg-white rounded-t-[4px]">
        <h4 className="font-medium text-[13px] text-[#1D1B16] leading-[16px] min-w-0">
          {dc.name}
        </h4>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="font-mono uppercase text-[8px] tracking-[0.05em] font-medium px-1.5 py-0.5 rounded-[2px]"
            style={{
              backgroundColor:
                display === "operational" || display === "construction"
                  ? "#FCDDCF"
                  : "#F6F6F6",
              color:
                display === "operational" || display === "construction"
                  ? "#FB631B"
                  : "#858483",
            }}
          >
            {STATUS_LABELS[display]}
          </span>
          <button
            onClick={() => map.closePopup()}
            aria-label="Close"
            className="text-[#ADADAC] hover:text-[#1D1B16] transition-colors -mr-1 -mt-0.5 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable body — keeps a long enriched popup from overflowing the map */}
      <div className="overflow-y-auto px-4 pt-2.5 pb-4">
      {/* Enriched description */}
      {e?.description && (
        <p className="text-[13px] text-[#5C5B59] leading-[20px] mb-2">
          {e.description}
        </p>
      )}

      {/* Core fields */}
      <div className="space-y-1 text-[13px] leading-[16px] text-[#5C5B59]">
        {dc.operator && (
          <div>
            <span className="text-[#ADADAC]">Operator:</span> {dc.operator}
          </div>
        )}
        {dc.owner && dc.owner !== dc.operator && (
          <div>
            <span className="text-[#ADADAC]">Owner:</span> {dc.owner}
          </div>
        )}
        <div>
          <span className="text-[#ADADAC]">Location:</span> {dc.city},{" "}
          {dc.state}
        </div>
        <div>
          <span className="text-[#ADADAC]">Type:</span> {dc.type}
        </div>
        {dc.powerMw > 0 && (
          <div>
            <span className="text-[#ADADAC]">Power:</span>{" "}
            <span className="font-mono">{formatPower(dc.powerMw)}</span>
          </div>
        )}
        {dc.sqft > 0 && (
          <div>
            <span className="text-[#ADADAC]">Size:</span>{" "}
            <span className="font-mono">{formatSqft(dc.sqft)}</span>
          </div>
        )}
        {dc.yearOnline && dc.yearOnline !== "unknown" && (
          <div>
            <span className="text-[#ADADAC]">Online:</span>{" "}
            <span className="font-mono">{dc.yearOnline}</span>
          </div>
        )}
        {e?.notable_tenants && (
          <div>
            <span className="text-[#ADADAC]">Tenants:</span>{" "}
            {e.notable_tenants}
          </div>
        )}
      </div>

      {/* AI classification (Task API) — compact; full analysis lives in the dataset view */}
      {dc.aiClassification && (
        <div className="mt-2 border border-[#E5E5E5] rounded-[4px] px-3 py-2">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#ADADAC]">
              AI classification
            </span>
            <span
              className="font-mono uppercase text-[8px] tracking-[0.05em] font-medium px-1.5 py-0.5 rounded-[2px] text-white"
              style={{ backgroundColor: AI_CLASS_COLORS[dc.aiClassification.ai_class] }}
            >
              {AI_CLASS_LABELS[dc.aiClassification.ai_class]}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            <ImpactChip label="Water" color={IMPACT_COLORS[dc.aiClassification.water_impact]} value={IMPACT_LABELS[dc.aiClassification.water_impact]} />
            <ImpactChip label="Grid" color={IMPACT_COLORS[dc.aiClassification.grid_impact]} value={IMPACT_LABELS[dc.aiClassification.grid_impact]} />
            <ImpactChip label="Community" color={PUSHBACK_COLORS[dc.aiClassification.community_pushback]} value={PUSHBACK_LABELS[dc.aiClassification.community_pushback]} />
          </div>
        </div>
      )}

      {/* Construction update */}
      {e?.construction_update && (
        <div className="mt-2 bg-[#F6F6F6] rounded-[4px] px-3 py-2 border border-[#E5E5E5]">
          <div className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#ADADAC] mb-0.5">
            Construction update
          </div>
          <p className="text-[13px] text-[#5C5B59] leading-[16px]">
            {e.construction_update}
          </p>
        </div>
      )}

      {/* Recent news */}
      {e?.recent_news && (
        <div className="mt-2 bg-[#FCDDCF]/30 rounded-[4px] px-3 py-2 border border-[#F9BC9F]">
          <div className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#FB631B] mb-0.5">
            Recent news
          </div>
          <p className="text-[13px] text-[#5C5B59] leading-[16px]">
            {e.recent_news}
          </p>
        </div>
      )}

      {/* Citations (loaded on demand from Task API basis) */}
      {(loadingCites || citations.length > 0) && (
        <div className="mt-2 pt-2 border-t border-[#E5E5E5]">
          <div className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#ADADAC] mb-1.5">
            {loadingCites && citations.length === 0
              ? "Loading sources…"
              : `Sources (${citations.length})`}
          </div>
          <div className="flex flex-wrap gap-1">
            {citations.map((c, i) => (
              <a
                key={i}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-mono text-[8px] uppercase tracking-[0.02em] text-[#858483] border border-[#E5E5E5] rounded-[2px] px-1.5 py-0.5 hover:border-[#FB631B] hover:text-[#FB631B] transition-colors"
              >
                {c.title.length > 30 ? c.title.slice(0, 30) + "..." : c.title}
                <ExternalLink className="w-2 h-2" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Enrichment badge */}
      {e && (
        <div className="mt-2 pt-2 border-t border-[#E5E5E5]">
          <span className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#ADADAC]">
            Enriched by Task API
            {e.enrichedAt &&
              ` · ${new Date(e.enrichedAt).toLocaleDateString()}`}
          </span>
        </div>
      )}
      </div>
    </div>
  );
}
