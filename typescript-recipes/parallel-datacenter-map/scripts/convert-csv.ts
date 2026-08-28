import * as fs from "fs";
import Papa from "papaparse";

const csvPath = "/Users/khushishelat/Downloads/datacenters_clean.csv";
const outPath = "./public/data/datacenters.json";

const raw = fs.readFileSync(csvPath, "utf-8");
const { data } = Papa.parse(raw, { header: true, skipEmptyLines: true });

const cleaned = (data as Record<string, string>[]).map((row) => ({
  name: row.name?.trim() || "",
  operator: row.operator_company?.trim() || "",
  owner: row.owner_company?.trim() || "",
  address: row.address?.trim() || "",
  city: row.city?.trim() || "",
  state: row.state?.trim() || "",
  zip: row.zip_code?.trim() || "",
  lat: parseFloat(row.latitude) || 0,
  lng: parseFloat(row.longitude) || 0,
  yearOnline: row.year_online?.trim() || "unknown",
  powerMw: Math.min(parseFloat(row.power_capacity_mw) || 0, 5000), // clamp absurd values
  sqft: parseFloat(row.total_sqft) || 0,
  type: row.facility_type?.trim() || "unknown",
  status: row.status?.trim() || "unknown",
  region: row._shard?.trim() || "",
})).filter((r) => r.lat !== 0 && r.lng !== 0); // drop rows with no coords

fs.writeFileSync(outPath, JSON.stringify(cleaned, null, 0));
console.log(`Wrote ${cleaned.length} datacenters to ${outPath}`);

// Stats
const statusCounts: Record<string, number> = {};
cleaned.forEach((r) => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
console.log("Status counts:", statusCounts);
