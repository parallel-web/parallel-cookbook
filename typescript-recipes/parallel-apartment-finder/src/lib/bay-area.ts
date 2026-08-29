// Bay Area city + neighborhood data, preloaded so the app never has to
// discover it at runtime: city centers drive the map, reference points anchor
// proximity scoring, rent floors drive auto-budgets and price plausibility,
// and neighborhood centroids resolve locally instead of via Nominatim
// (~1s per lookup). Pure data — safe to import from client and server code.
//
// rentFloors = entry-level ("starts around") monthly rent per bedroom count,
// calibrated to mid-2026 Bay Area asking rents (Zumper / Zillow / apartments.com,
// July 2026 — after the ~22% YoY AI-boom spike). Studio and 4-5BR are
// interpolated where listing data is thin (studio ≈ 0.78×1BR, +N BR ≈ ×1.2).

export type LatLng = { lat: number; lng: number }

export type BayAreaNeighborhood = {
  name: string
  lat: number
  lng: number
}

export type BayAreaCity = {
  /** Stable key, e.g. "san-francisco" */
  key: string
  /** Display label and search-bar value, e.g. "San Francisco" */
  label: string
  /** Full form used in FindAll objectives and geocode queries */
  full: string
  aliases: string[]
  center: LatLng
  zoom: number
  referencePoint: { name: string } & LatLng
  /** Typical monthly-rent floors by bedroom count (string keys to match AppConfig) */
  rentFloors: Record<string, number>
  neighborhoods: BayAreaNeighborhood[]
}

export const BAY_AREA_CITIES: BayAreaCity[] = [
  {
    key: "san-francisco",
    label: "San Francisco",
    full: "San Francisco, CA",
    aliases: ["sf", "san fran"],
    center: { lat: 37.7749, lng: -122.4194 },
    zoom: 13,
    referencePoint: { name: "Caltrain · 4th & King", lat: 37.7764, lng: -122.3973 },
    rentFloors: { 0: 2500, 1: 3400, 2: 4600, 3: 6200, 4: 7800, 5: 9500 },
    neighborhoods: [
      { name: "Mission", lat: 37.7599, lng: -122.4148 },
      { name: "SoMa", lat: 37.7785, lng: -122.4056 },
      { name: "South Beach", lat: 37.7813, lng: -122.3892 },
      { name: "Mission Bay", lat: 37.7699, lng: -122.3922 },
      { name: "Dogpatch", lat: 37.7576, lng: -122.3884 },
      { name: "Potrero Hill", lat: 37.7605, lng: -122.4005 },
      { name: "Noe Valley", lat: 37.7502, lng: -122.4337 },
      { name: "Castro", lat: 37.7609, lng: -122.435 },
      { name: "Hayes Valley", lat: 37.7759, lng: -122.4245 },
      { name: "NoPa", lat: 37.7777, lng: -122.4404 },
      { name: "Lower Haight", lat: 37.772, lng: -122.4306 },
      { name: "Haight-Ashbury", lat: 37.7692, lng: -122.4463 },
      { name: "Duboce Triangle", lat: 37.769, lng: -122.433 },
      { name: "Bernal Heights", lat: 37.7399, lng: -122.4166 },
      { name: "Glen Park", lat: 37.7331, lng: -122.4338 },
      { name: "Inner Sunset", lat: 37.7601, lng: -122.4692 },
      { name: "Outer Sunset", lat: 37.7554, lng: -122.4946 },
      { name: "Sunset", lat: 37.7554, lng: -122.485 },
      { name: "Inner Richmond", lat: 37.7801, lng: -122.4645 },
      { name: "Outer Richmond", lat: 37.7783, lng: -122.4893 },
      { name: "Richmond", lat: 37.78, lng: -122.47 },
      { name: "Marina", lat: 37.8021, lng: -122.4369 },
      { name: "Cow Hollow", lat: 37.7976, lng: -122.4359 },
      { name: "Pacific Heights", lat: 37.7925, lng: -122.4382 },
      { name: "Nob Hill", lat: 37.793, lng: -122.4161 },
      { name: "Russian Hill", lat: 37.8014, lng: -122.4182 },
      { name: "North Beach", lat: 37.806, lng: -122.4103 },
      { name: "Telegraph Hill", lat: 37.8024, lng: -122.4058 },
      { name: "Financial District", lat: 37.7946, lng: -122.3999 },
      { name: "Tenderloin", lat: 37.7847, lng: -122.4145 },
      { name: "Chinatown", lat: 37.7941, lng: -122.4078 },
      { name: "Western Addition", lat: 37.7804, lng: -122.4293 },
      { name: "Fillmore", lat: 37.784, lng: -122.433 },
      { name: "Japantown", lat: 37.7854, lng: -122.4297 },
      { name: "Excelsior", lat: 37.7249, lng: -122.426 },
      { name: "Bayview", lat: 37.7299, lng: -122.3865 },
    ],
  },
  {
    key: "oakland",
    label: "Oakland",
    full: "Oakland, CA",
    aliases: [],
    center: { lat: 37.8044, lng: -122.2712 },
    zoom: 13,
    referencePoint: { name: "19th St BART", lat: 37.808, lng: -122.2687 },
    rentFloors: { 0: 1700, 1: 2200, 2: 2800, 3: 3600, 4: 4500, 5: 5400 },
    neighborhoods: [
      { name: "Temescal", lat: 37.834, lng: -122.262 },
      { name: "Rockridge", lat: 37.8443, lng: -122.2519 },
      { name: "Lake Merritt", lat: 37.8021, lng: -122.2571 },
      { name: "Uptown", lat: 37.809, lng: -122.2705 },
      { name: "Downtown", lat: 37.8027, lng: -122.2716 },
      { name: "Jack London Square", lat: 37.7946, lng: -122.2782 },
      { name: "Grand Lake", lat: 37.811, lng: -122.247 },
      { name: "Adams Point", lat: 37.8095, lng: -122.256 },
      { name: "Fruitvale", lat: 37.7752, lng: -122.2242 },
      { name: "West Oakland", lat: 37.8126, lng: -122.2949 },
      { name: "Piedmont Avenue", lat: 37.825, lng: -122.253 },
      { name: "Montclair", lat: 37.828, lng: -122.21 },
      { name: "Laurel", lat: 37.793, lng: -122.197 },
      { name: "Dimond", lat: 37.794, lng: -122.211 },
    ],
  },
  {
    key: "berkeley",
    label: "Berkeley",
    full: "Berkeley, CA",
    aliases: [],
    center: { lat: 37.8715, lng: -122.273 },
    zoom: 14,
    referencePoint: { name: "Downtown Berkeley BART", lat: 37.8701, lng: -122.2681 },
    rentFloors: { 0: 1900, 1: 2300, 2: 2900, 3: 3600, 4: 4300, 5: 5200 },
    neighborhoods: [
      { name: "Downtown", lat: 37.87, lng: -122.27 },
      { name: "Southside", lat: 37.866, lng: -122.258 },
      { name: "Northside", lat: 37.876, lng: -122.26 },
      { name: "Elmwood", lat: 37.858, lng: -122.253 },
      { name: "North Berkeley", lat: 37.88, lng: -122.282 },
      { name: "West Berkeley", lat: 37.866, lng: -122.296 },
      { name: "South Berkeley", lat: 37.848, lng: -122.273 },
      { name: "Claremont", lat: 37.859, lng: -122.242 },
    ],
  },
  {
    key: "san-jose",
    label: "San Jose",
    full: "San Jose, CA",
    aliases: ["sj"],
    center: { lat: 37.3382, lng: -121.8863 },
    zoom: 12,
    referencePoint: { name: "Diridon Station", lat: 37.3297, lng: -121.9026 },
    rentFloors: { 0: 2100, 1: 2600, 2: 3300, 3: 4300, 4: 5300, 5: 6300 },
    neighborhoods: [
      { name: "Downtown", lat: 37.335, lng: -121.89 },
      { name: "Japantown", lat: 37.348, lng: -121.894 },
      { name: "Willow Glen", lat: 37.308, lng: -121.89 },
      { name: "Rose Garden", lat: 37.331, lng: -121.918 },
      { name: "Santana Row", lat: 37.321, lng: -121.948 },
      { name: "North San Jose", lat: 37.39, lng: -121.93 },
      { name: "Berryessa", lat: 37.395, lng: -121.86 },
      { name: "Cambrian", lat: 37.257, lng: -121.93 },
      { name: "Almaden Valley", lat: 37.236, lng: -121.86 },
      { name: "Evergreen", lat: 37.306, lng: -121.786 },
    ],
  },
  {
    key: "palo-alto",
    label: "Palo Alto",
    full: "Palo Alto, CA",
    aliases: [],
    center: { lat: 37.4419, lng: -122.143 },
    zoom: 13,
    referencePoint: { name: "Palo Alto Caltrain", lat: 37.4433, lng: -122.165 },
    rentFloors: { 0: 2600, 1: 3300, 2: 4300, 3: 5800, 4: 7200, 5: 8800 },
    neighborhoods: [
      { name: "Downtown", lat: 37.445, lng: -122.161 },
      { name: "Midtown", lat: 37.433, lng: -122.129 },
      { name: "College Terrace", lat: 37.425, lng: -122.152 },
      { name: "Crescent Park", lat: 37.452, lng: -122.145 },
      { name: "Old Palo Alto", lat: 37.436, lng: -122.15 },
      { name: "Barron Park", lat: 37.413, lng: -122.136 },
    ],
  },
  {
    key: "mountain-view",
    label: "Mountain View",
    full: "Mountain View, CA",
    aliases: ["mv"],
    center: { lat: 37.3861, lng: -122.0839 },
    zoom: 13,
    referencePoint: { name: "Mountain View Caltrain", lat: 37.3945, lng: -122.076 },
    rentFloors: { 0: 2500, 1: 3100, 2: 3900, 3: 5100, 4: 6200, 5: 7200 },
    neighborhoods: [
      { name: "Downtown", lat: 37.394, lng: -122.079 },
      { name: "Old Mountain View", lat: 37.39, lng: -122.082 },
      { name: "North Bayshore", lat: 37.423, lng: -122.085 },
      { name: "Shoreline West", lat: 37.4, lng: -122.09 },
      { name: "Whisman", lat: 37.402, lng: -122.062 },
      { name: "San Antonio", lat: 37.407, lng: -122.109 },
    ],
  },
  {
    key: "sunnyvale",
    label: "Sunnyvale",
    full: "Sunnyvale, CA",
    aliases: [],
    center: { lat: 37.3688, lng: -122.0363 },
    zoom: 13,
    referencePoint: { name: "Sunnyvale Caltrain", lat: 37.3784, lng: -122.0312 },
    rentFloors: { 0: 2400, 1: 3000, 2: 3700, 3: 4800, 4: 5800, 5: 6800 },
    neighborhoods: [
      { name: "Downtown", lat: 37.377, lng: -122.03 },
      { name: "Cherry Chase", lat: 37.355, lng: -122.045 },
      { name: "Lakewood", lat: 37.396, lng: -122.013 },
      { name: "Ponderosa", lat: 37.35, lng: -122.017 },
      { name: "Birdland", lat: 37.36, lng: -122.063 },
    ],
  },
  {
    key: "redwood-city",
    label: "Redwood City",
    full: "Redwood City, CA",
    aliases: [],
    center: { lat: 37.4852, lng: -122.2364 },
    zoom: 13,
    referencePoint: { name: "Redwood City Caltrain", lat: 37.4857, lng: -122.2317 },
    rentFloors: { 0: 2300, 1: 2900, 2: 3600, 3: 4700, 4: 5700, 5: 6700 },
    neighborhoods: [
      { name: "Downtown", lat: 37.486, lng: -122.231 },
      { name: "Centennial", lat: 37.489, lng: -122.24 },
      { name: "Woodside Plaza", lat: 37.468, lng: -122.253 },
      { name: "Redwood Shores", lat: 37.533, lng: -122.247 },
      { name: "Friendly Acres", lat: 37.475, lng: -122.214 },
    ],
  },
  {
    key: "daly-city",
    label: "Daly City",
    full: "Daly City, CA",
    aliases: [],
    center: { lat: 37.6879, lng: -122.4702 },
    zoom: 13,
    referencePoint: { name: "Daly City BART", lat: 37.7063, lng: -122.4692 },
    rentFloors: { 0: 1900, 1: 2500, 2: 3200, 3: 4100, 4: 4900, 5: 5700 },
    neighborhoods: [
      { name: "Westlake", lat: 37.701, lng: -122.485 },
      { name: "Serramonte", lat: 37.671, lng: -122.472 },
      { name: "Original Daly City", lat: 37.706, lng: -122.46 },
      { name: "Crocker", lat: 37.679, lng: -122.455 },
    ],
  },
  {
    key: "fremont",
    label: "Fremont",
    full: "Fremont, CA",
    aliases: [],
    center: { lat: 37.5485, lng: -121.9886 },
    zoom: 12,
    referencePoint: { name: "Fremont BART", lat: 37.5574, lng: -121.9766 },
    rentFloors: { 0: 2000, 1: 2600, 2: 3300, 3: 4200, 4: 5000, 5: 5800 },
    neighborhoods: [
      { name: "Centerville", lat: 37.554, lng: -122.001 },
      { name: "Niles", lat: 37.577, lng: -121.981 },
      { name: "Irvington", lat: 37.522, lng: -121.963 },
      { name: "Mission San Jose", lat: 37.527, lng: -121.92 },
      { name: "Ardenwood", lat: 37.556, lng: -122.057 },
      { name: "Warm Springs", lat: 37.489, lng: -121.929 },
    ],
  },
]

const byName = new Map<string, BayAreaCity>()
for (const c of BAY_AREA_CITIES) {
  byName.set(c.key, c)
  byName.set(c.label.toLowerCase(), c)
  byName.set(c.full.toLowerCase(), c)
  for (const a of c.aliases) byName.set(a, c)
}

/** Resolve "SF", "Oakland", "Oakland, CA", "san-jose", … to a city entry. */
export function cityByName(name: string | null | undefined): BayAreaCity | null {
  if (!name) return null
  const key = name.toLowerCase().trim()
  return byName.get(key) ?? byName.get(key.split(",")[0].trim()) ?? null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// City label + alias terms, longest first so "Palo Alto" wins over a shorter
// alias and multi-word names match before single tokens.
const CITY_QUERY_TERMS: { term: string; city: BayAreaCity }[] = BAY_AREA_CITIES
  .flatMap((c) => [c.label, ...c.aliases].map((term) => ({ term, city: c })))
  .sort((a, b) => b.term.length - a.term.length)

/**
 * Detect a Bay Area city named anywhere in a free-text query, case-insensitive
 * and word-bounded, e.g. "Palo Alto homes in the bubble" -> Palo Alto. Returns
 * null when no known city (or alias) is mentioned.
 */
export function cityInQuery(query: string | null | undefined): BayAreaCity | null {
  if (!query || !query.trim()) return null
  for (const { term, city } of CITY_QUERY_TERMS) {
    if (new RegExp(`(?<![\\w-])${escapeRegExp(term)}(?![\\w-])`, "i").test(query)) return city
  }
  return null
}

// Enrichment phrases neighborhoods loosely ("Mission District", "the
// Marina"), so normalize before matching the table.
function normalizeNeighborhood(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "")
    .replace(/\s+(district|neighborhood|area|hood)$/, "")
    .trim()
}

/** Local neighborhood-centroid lookup; null when the pair isn't in the table. */
export function neighborhoodCentroid(
  city: string | null | undefined,
  neighborhood: string | null | undefined,
): LatLng | null {
  const c = cityByName(city)
  if (!c || !neighborhood) return null
  const key = normalizeNeighborhood(neighborhood)
  const hit = c.neighborhoods.find((n) => normalizeNeighborhood(n.name) === key)
  return hit ? { lat: hit.lat, lng: hit.lng } : null
}
