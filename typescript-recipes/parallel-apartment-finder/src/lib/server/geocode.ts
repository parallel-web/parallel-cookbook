// OSM Nominatim geocoding.
// Callers must sequence requests (~1/s) per Nominatim's usage policy.

import { CITY, GEO_COUNTRY } from "./config"

function cleanAddress(address: string): string {
  let cleaned = address.replace(/^\d+BR,?\s*/, "")
  cleaned = cleaned.replace(/\s*-\s*\$[\d,]+\/month$/, "")
  cleaned = cleaned.replace(/,?\s*\$[\d,]+\/month$/, "")
  cleaned = cleaned.replace(/\s*-\s*Apartments?\.?.*$/i, "")
  cleaned = cleaned.replace(/\s+Apt\.?\s+[\w-]+/gi, "")
  cleaned = cleaned.replace(/\s+Unit\s+[\w-]+/gi, "")
  cleaned = cleaned.replace(/\s+Suite\s+[\w-]+/gi, "")
  cleaned = cleaned.replace(/\s+#\s*[\w-]+/g, "")
  cleaned = cleaned.replace(/\s+Apartments?,?\s*/gi, " ")
  return cleaned.trim().replace(/,$/, "").trim()
}

async function queryNominatim(q: string): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams({
    q, format: "json", limit: "1", countrycodes: GEO_COUNTRY,
  })
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": "ApartmentFinder/1.0 (apartment search app)" },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json() as { lat: string; lon: string }[]
    if (!data.length) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  } catch {
    return null
  }
}

// Neighborhood-centroid fallback for when the street address won't resolve.
// Callers must apply the same ~1/s sequencing as geocodeAddress.
export async function geocodeNeighborhood(
  neighborhood: string,
  city?: string | null,
): Promise<{ lat: number; lng: number } | null> {
  const targetCity = city?.trim() || CITY
  const n = neighborhood.trim()
  if (n.length < 3) return null
  return queryNominatim(`${n}, ${targetCity}`)
}

export async function geocodeAddress(
  rawAddress: string,
  city?: string | null,
): Promise<{ lat: number; lng: number } | null> {
  const targetCity = city?.trim() || CITY
  const address = cleanAddress(rawAddress)
  if (!address || address.length < 4) return null

  const query = address.toLowerCase().includes(targetCity.toLowerCase())
    ? address : `${address}, ${targetCity}`
  const coords = await queryNominatim(query)
  if (coords) return coords

  // Fallback: strip the street-type suffix, which sometimes confuses OSM.
  const simplified = address.replace(
    /\s+(St|Ave|Blvd|Dr|Rd|Ct|Way|Ln|Pl|Street|Avenue|Boulevard|Drive|Road|Court|Place|Lane)\.?\b/gi, "",
  )
  if (simplified !== address) {
    const fq = simplified.toLowerCase().includes(targetCity.toLowerCase())
      ? simplified : `${simplified}, ${targetCity}`
    return queryNominatim(fq)
  }
  return null
}
