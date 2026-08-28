import type {
  AiClass,
  CommunityPushback,
  DisplayStatus,
  ImpactLevel,
  MonitorCategory,
} from "./types";

export const STATUS_MAP: Record<string, DisplayStatus> = {
  operational: "operational",
  "under-construction": "construction",
  planned: "planned",
  unknown: "unknown",
  decommissioned: "decommissioned",
};

export const STATUS_COLORS: Record<DisplayStatus, string> = {
  operational: "#FB631B",
  construction: "#F79A6F",
  planned: "#5C5B59",
  unknown: "#D6D6D6",
  decommissioned: "#434343",
};

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  operational: "Operational",
  construction: "Under Construction",
  planned: "Planned",
  unknown: "Unknown",
  decommissioned: "Decommissioned",
};

export const MONITOR_CATEGORY_LABELS: Record<MonitorCategory, string> = {
  POWER_GRID: "Power & Grid",
  ZONING_POLICY: "Zoning & Policy",
  COMMUNITY: "Community",
  WATER: "Water & Cooling",
  LAND_SUPPLY: "Land & Supply",
  TENANT_DEMAND: "Tenant & Demand",
  CAPITAL_OWNERSHIP: "Capital & Ownership",
  CONSTRUCTION: "Construction",
};

export const MONITOR_CATEGORY_COLORS: Record<MonitorCategory, string> = {
  POWER_GRID: "#FB631B",
  ZONING_POLICY: "#F79A6F",
  COMMUNITY: "#5C5B59",
  WATER: "#8FB6CC",
  LAND_SUPPLY: "#D8D0BF",
  TENANT_DEMAND: "#FB631B",
  CAPITAL_OWNERSHIP: "#E14942",
  CONSTRUCTION: "#858483",
};

export const SEVERITY_COLORS: Record<string, string> = {
  critical: "#E14942",
  notable: "#FB631B",
  informational: "#858483",
};

export const AI_CLASS_LABELS: Record<AiClass, string> = {
  "ai-training": "AI Training",
  "ai-inference": "AI Inference",
  "ai-mixed": "AI Mixed Use",
  "cloud-hyperscale": "Cloud Hyperscale",
  "not-ai": "Colo / Enterprise",
};

export const AI_CLASS_COLORS: Record<AiClass, string> = {
  "ai-training": "#1D1B16",
  "ai-inference": "#434343",
  "ai-mixed": "#5C5B59",
  "cloud-hyperscale": "#858483",
  "not-ai": "#ADADAC",
};

export const IMPACT_LABELS: Record<ImpactLevel, string> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
  unknown: "Unknown",
};

export const IMPACT_COLORS: Record<ImpactLevel, string> = {
  high: "#E14942",
  moderate: "#FB631B",
  low: "#69BE78",
  unknown: "#D6D6D6",
};

export const PUSHBACK_LABELS: Record<CommunityPushback, string> = {
  "active-opposition": "Active opposition",
  "some-concern": "Some concern",
  "none-found": "None found",
};

export const PUSHBACK_COLORS: Record<CommunityPushback, string> = {
  "active-opposition": "#E14942",
  "some-concern": "#FB631B",
  "none-found": "#69BE78",
};

/** Maps US states to the monitor that covers them */
export const STATE_TO_MONITOR: Record<string, string> = {
  VA: "region-nova",
  GA: "region-atlanta",
  OH: "region-ohio",
  AZ: "region-phoenix",
  UT: "region-utah",
  TX: "region-texas",
  WA: "region-pnw",
  OR: "region-pnw",
  FL: "region-florida",
  IL: "region-chicago",
  NJ: "region-nymetro",
  NY: "region-nymetro",
  MA: "region-newengland",
  CT: "region-newengland",
  NH: "region-newengland",
  ME: "region-newengland",
  RI: "region-newengland",
  VT: "region-newengland",
  MN: "region-minnesota",
  MI: "region-michigan",
  KY: "region-kentucky",
  NV: "region-nevada",
  MD: "region-dcmetro",
  DC: "region-dcmetro",
  DE: "region-dcmetro",
  TN: "region-tennessee",
  MO: "region-midwest",
  KS: "region-midwest",
  NE: "region-midwest",
  IA: "region-midwest",
  NC: "region-carolinas",
  SC: "region-carolinas",
  CO: "region-colorado",
  PA: "region-pennsylvania",
  // CA needs special handling (NorCal vs SoCal by latitude)
  CA: "region-norcal", // default; SoCal for lat < 35.5
};

/** Latitude threshold for NorCal vs SoCal */
export const CA_SPLIT_LAT = 35.5;

/** Region centroids for map flyTo */
export const REGION_CENTROIDS: Record<string, [number, number]> = {
  "region-nova": [38.95, -77.45],
  "region-atlanta": [33.75, -84.39],
  "region-ohio": [40.05, -82.75],
  "region-phoenix": [33.45, -112.07],
  "region-utah": [40.55, -111.90],
  "region-texas": [31.0, -97.5],
  "region-pnw": [47.6, -122.3],
  "region-florida": [28.5, -81.5],
  "region-norcal": [37.4, -122.0],
  "region-socal": [34.0, -118.2],
  "region-chicago": [41.88, -87.63],
  "region-nymetro": [40.7, -74.2],
  "region-newengland": [42.36, -71.06],
  "region-minnesota": [44.97, -93.27],
  "region-michigan": [42.33, -83.05],
  "region-kentucky": [38.25, -85.76],
  "region-nevada": [36.17, -115.14],
  "region-dcmetro": [39.0, -76.7],
  "region-tennessee": [36.16, -86.78],
  "region-midwest": [39.1, -94.58],
  "region-carolinas": [35.78, -78.64],
  "region-colorado": [39.74, -104.99],
  "region-pennsylvania": [40.0, -75.5],
};

export const MAP_CENTER: [number, number] = [39.8283, -98.5795];
export const MAP_ZOOM = 5;
export const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';
