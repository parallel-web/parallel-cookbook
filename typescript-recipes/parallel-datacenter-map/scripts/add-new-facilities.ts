/**
 * Adds new facilities from an enriched CSV to the existing dataset.
 * Only adds rows that don't already exist (by lat/lng coordinate match).
 * Preserves all existing data untouched.
 *
 * Usage: npx tsx scripts/add-new-facilities.ts /path/to/enriched.csv
 */

import * as fs from "fs";
import Papa from "papaparse";

const csvPath = process.argv[2];
if (!csvPath) { console.error("Usage: npx tsx scripts/add-new-facilities.ts /path/to/enriched.csv"); process.exit(1); }

// Load existing data
const dcPath = "./public/data/datacenters.json";
const compactPath = "./public/data/enrichments-compact.json";

const existing: Record<string, unknown>[] = JSON.parse(fs.readFileSync(dcPath, "utf-8"));
const compact: Record<string, Record<string, unknown>> = fs.existsSync(compactPath)
  ? JSON.parse(fs.readFileSync(compactPath, "utf-8"))
  : {};

console.log(`Existing: ${existing.length} facilities, ${Object.keys(compact).length} enrichments`);

// Build index of existing coords
const existingCoords = new Set<string>();
for (const dc of existing) {
  existingCoords.add(`${(dc as { lat: number }).lat.toFixed(6)},${(dc as { lng: number }).lng.toFixed(6)}`);
}

// Parse new CSV
const raw = fs.readFileSync(csvPath, "utf-8");
const { data } = Papa.parse(raw, { header: true, skipEmptyLines: true });
const rows = data as Record<string, string>[];

console.log(`CSV: ${rows.length} rows`);

let added = 0;
let skipped = 0;

for (const row of rows) {
  const lat = parseFloat(row.latitude) || 0;
  const lng = parseFloat(row.longitude) || 0;
  if (lat === 0 && lng === 0) { skipped++; continue; }

  const coordKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  if (existingCoords.has(coordKey)) { skipped++; continue; }

  // Filter out unknown/empty status
  const status = (row.verified_status || row.status || "").trim();
  if (!status || status === "unknown") { skipped++; continue; }

  existingCoords.add(coordKey); // prevent dupes within new data

  const newIndex = existing.length;

  // Add to datacenters.json (base fields only)
  const dc = {
    name: (row.verified_name || row.name || "").trim(),
    operator: (row.verified_operator || row.operator_company || "").trim(),
    owner: (row.verified_owner || row.owner_company || "").trim(),
    address: (row.address || "").trim(),
    city: (row.city || "").trim(),
    state: (row.state || "").trim(),
    zip: (row.zip_code || "").trim(),
    lat,
    lng,
    yearOnline: (row.year_online || "unknown").trim(),
    powerMw: Math.min(parseFloat(row.power_capacity_mw) || 0, 5000),
    sqft: parseFloat(row.total_sqft) || 0,
    type: (row.facility_type || "unknown").trim(),
    status,
    region: (row._shard || "").trim(),
  };
  existing.push(dc);

  // Add to enrichments-compact.json
  compact[String(newIndex)] = {
    description: (row.description || "").trim(),
    verified_status: status,
    power_capacity_mw: parseFloat(row.power_capacity_mw) || 0,
    total_sqft: parseFloat(row.total_sqft) || 0,
    year_online: (row.year_online || "").trim(),
    construction_update: (row.construction_update || "").trim(),
    recent_news: (row.recent_news || "").trim(),
    notable_tenants: (row.notable_tenants || "").trim(),
    verified_name: (row.verified_name || "").trim(),
    verified_operator: (row.verified_operator || "").trim(),
    verified_owner: (row.verified_owner || "").trim(),
    cooling_type: (row.cooling_type || "").trim(),
    tier_level: (row.tier_level || "").trim(),
    fiber_providers: (row.fiber_providers || "").trim(),
    num_buildings: parseFloat(row.num_buildings) || 0,
    campus_acres: parseFloat(row.campus_acres) || 0,
    utility_provider: (row.utility_provider || "").trim(),
    tax_incentives: (row.tax_incentives || "").trim(),
    natural_hazard_zone: (row.natural_hazard_zone || "").trim(),
  };

  added++;
}

// Save
fs.writeFileSync(dcPath, JSON.stringify(existing));
fs.writeFileSync(compactPath, JSON.stringify(compact, null, 0));

console.log(`\nAdded: ${added} new facilities`);
console.log(`Skipped: ${skipped} (existing, missing coords, or unknown status)`);
console.log(`Total now: ${existing.length} facilities, ${Object.keys(compact).length} enrichments`);
console.log(`\nSaved to ${dcPath} and ${compactPath}`);
