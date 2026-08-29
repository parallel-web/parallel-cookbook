// Builds the AppConfig object served to the client. Called from the server
// layout (config is inlined into the initial HTML — no client fetch) and from
// the /api/config route used by the /docs live-config table.

import {
  APP_TITLE, CITY, CITY_SHORT, DEFAULT_BUDGET,
  REFERENCE_POINT_NAME, REFERENCE_POINT_LAT, REFERENCE_POINT_LNG,
  MAP_CENTER_LAT, MAP_CENTER_LNG, MAP_ZOOM,
  BRAND_NAME, BRAND_LOGO_URL,
  SUGGESTIONS, RENT_FLOORS,
  AGGREGATOR_SOURCES, STALE_AGGREGATOR_DAYS, STALE_DIRECT_DAYS,
} from "./config"
import type { AppConfig } from "@/types"

export function buildAppConfig(): AppConfig {
  return {
    appTitle: APP_TITLE,
    city: CITY,
    cityShort: CITY_SHORT,
    referencePoint: {
      name: REFERENCE_POINT_NAME,
      lat: REFERENCE_POINT_LAT,
      lng: REFERENCE_POINT_LNG,
    },
    mapCenter: { lat: MAP_CENTER_LAT, lng: MAP_CENTER_LNG },
    mapZoom: MAP_ZOOM,
    defaultBudget: DEFAULT_BUDGET,
    brand: {
      name: BRAND_NAME,
      logoUrl: BRAND_LOGO_URL,
    },
    suggestions: SUGGESTIONS,
    rentFloors: Object.fromEntries(
      Object.entries(RENT_FLOORS).map(([k, v]) => [String(k), v]),
    ),
    staleness: {
      aggregatorSources: AGGREGATOR_SOURCES,
      aggregatorDays: STALE_AGGREGATOR_DAYS,
      directDays: STALE_DIRECT_DAYS,
    },
  }
}
