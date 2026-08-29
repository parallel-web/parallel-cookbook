"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"
import { escapeHtml } from "@/lib/utils"
import type { AppConfig, Listing } from "@/types"

const Z_BLUE = "#fb631b"
const Z_BLUE_DARK = "#1D4ED8"
const Z_GREEN = "#137333"
const Z_AMBER = "#C77700"
const Z_RED = "#C62828"

function markerColor(score: number | null | undefined) {
  if (score == null) return Z_BLUE_DARK
  if (score >= 70) return Z_GREEN
  if (score >= 45) return Z_AMBER
  return Z_RED
}

function priceLabel(l: Listing): string {
  if (!l.price) return "—"
  if (l.price >= 1000) return `$${Math.round(l.price / 100) / 10}k`
  return `$${l.price}`
}

function makePriceTag(l: Listing, hovered: boolean, saved = false) {
  // Saved targets are pinned in brand orange with a star so the shortlist
  // stands out from score-colored result tags; results keep score coloring.
  const color = saved ? Z_BLUE : markerColor(l.score)
  const label = saved ? `★ ${priceLabel(l)}` : priceLabel(l)
  const filled = saved || hovered
  const w = Math.max(56, Math.ceil(label.length * 7.5) + 20)
  const h = 26
  return L.divIcon({
    className: "zillow-price-tag",
    html: `<div style="
        background:${filled ? color : "white"};
        color:${filled ? "white" : color};
        border:2px solid ${color};
        width:100%;
        height:100%;
        display:flex;
        align-items:center;
        justify-content:center;
        border-radius:13px;
        font-family:'Geist Variable',system-ui,sans-serif;
        font-weight:700;
        font-size:12px;
        line-height:1;
        letter-spacing:-0.01em;
        white-space:nowrap;
        box-shadow:0 1px 3px rgba(15,17,21,0.15), 0 0 0 1px rgba(15,17,21,0.04);
        cursor:pointer;
        box-sizing:border-box;
      ">${label}</div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  })
}

function makeRefIcon() {
  const size = 16
  return L.divIcon({
    className: "zillow-ref-pin",
    html: `<div style="
        background:${Z_BLUE};
        width:100%;height:100%;
        border:3px solid white;
        border-radius:50%;
        box-sizing:border-box;
        box-shadow:0 0 0 2px ${Z_BLUE}, 0 2px 6px rgba(15,17,21,0.2);
      "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// Neighborhood-precision listings all sit on the same centroid; spread them
// with a deterministic ~±150m jitter (hashed from the listing id) so their
// price tags don't stack into one unreadable pile.
function displayCoords(l: Listing): L.LatLngTuple {
  if (l.geo_precision !== "neighborhood") return [l.lat!, l.lng!]
  let h = 0
  for (let i = 0; i < l.id.length; i++) h = (h * 31 + l.id.charCodeAt(i)) | 0
  const dLat = (((h & 0xff) / 255) - 0.5) * 0.0028
  const dLng = ((((h >> 8) & 0xff) / 255) - 0.5) * 0.0028
  return [l.lat! + dLat, l.lng! + dLng]
}

type MapProps = {
  listings: Listing[]
  config: AppConfig | null
  hoveredId?: string | null
  onMarkerClick?: (id: string) => void
  savedIds?: Set<string>
  height?: number
}

export function ApartmentMap({ listings, config, hoveredId, onMarkerClick, savedIds, height = 600 }: MapProps) {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const layerRef = useRef<L.LayerGroup | null>(null)

  const centerLat = config?.mapCenter.lat ?? 39.8283
  const centerLng = config?.mapCenter.lng ?? -98.5795
  const zoom = config?.mapZoom ?? 4

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const markers = markersRef.current

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([centerLat, centerLng], zoom)

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(map)

    if (config?.referencePoint) {
      L.marker([config.referencePoint.lat, config.referencePoint.lng], { icon: makeRefIcon() })
        .addTo(map)
        .bindTooltip(config.referencePoint.name, {
          direction: "top",
          offset: [0, -8],
          className: "zillow-map-tooltip",
        })
    }

    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      markers.clear()
    }
  }, [centerLat, centerLng, zoom, config])

  useEffect(() => {
    if (!layerRef.current || !mapRef.current) return
    layerRef.current.clearLayers()
    markersRef.current.clear()

    const bounds: L.LatLngTuple[] = []
    for (const l of listings) {
      if (l.lat == null || l.lng == null) continue
      const pos = displayCoords(l)
      bounds.push(pos)
      const marker = L.marker(pos, { icon: makePriceTag(l, false, savedIds?.has(l.id)) })
      marker.addTo(layerRef.current!)
      // Listing text is scraped/LLM-extracted (untrusted) and Leaflet injects
      // this string as raw HTML — escape every interpolated field.
      const name = escapeHtml(l.address || l.title || "—")
      const price = l.price ? `$${l.price.toLocaleString()}/mo` : "—"
      const beds = l.bedrooms != null ? `${l.bedrooms}bd` : ""
      const approx = l.geo_precision === "neighborhood" ? "≈ neighborhood-level location" : ""
      marker.bindTooltip(
        `<div style="font-family:'Geist Variable',system-ui,sans-serif;font-size:12px;line-height:1.4;color:#0E1117;">
          <strong style="display:block;margin-bottom:2px;">${name}</strong>
          <span style="color:#5C6370;">${escapeHtml([beds, price, approx].filter(Boolean).join(" · "))}</span>
        </div>`,
        { direction: "top", offset: [0, -8], className: "zillow-map-tooltip" },
      )
      if (onMarkerClick) {
        marker.on("click", () => onMarkerClick(l.id))
      }
      markersRef.current.set(l.id, marker)
    }

    if (bounds.length >= 2) {
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    } else if (bounds.length === 1) {
      mapRef.current.setView(bounds[0], 14)
    }
  }, [listings, onMarkerClick, savedIds])

  useEffect(() => {
    for (const [id, marker] of markersRef.current.entries()) {
      const l = listings.find((x) => x.id === id)
      if (!l) continue
      marker.setIcon(makePriceTag(l, id === hoveredId, savedIds?.has(id)))
      if (id === hoveredId) {
        marker.setZIndexOffset(1000)
      } else {
        marker.setZIndexOffset(0)
      }
    }
  }, [hoveredId, listings, savedIds])

  return (
    <div
      ref={containerRef}
      style={{
        height,
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid #E4E7EC",
      }}
    />
  )
}
