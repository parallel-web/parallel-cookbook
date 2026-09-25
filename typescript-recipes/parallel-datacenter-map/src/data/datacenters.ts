import type { AiClassification, Datacenter } from "@/lib/types";
import rawData from "../../public/data/datacenters.json";
import compactData from "../../public/data/enrichments-compact.json";
import aiData from "../../public/data/ai-classifications.json";

const compactMap = compactData as Record<string, Record<string, unknown>>;
const aiMap = aiData as Record<string, AiClassification>;

// Merge enrichment + AI classification onto each raw row, stamping the original
// index (the key into all index-addressed data: compact/AI maps, snapshot
// monitors, and per-facility blob files).
const enriched: Datacenter[] = (rawData as Datacenter[]).map((raw, i) => {
  const ai = aiMap[String(i)];
  const base: Datacenter = { ...raw, sourceIndex: i, ...(ai ? { aiClassification: ai } : {}) };

  const e = compactMap[String(i)];
  if (!e) return base;

  const name =
    (e.verified_name as string) && (e.verified_name as string) !== raw.name
      ? (e.verified_name as string)
      : raw.name;
  const operator =
    (e.verified_operator as string) && (e.verified_operator as string) !== raw.operator
      ? (e.verified_operator as string)
      : raw.operator;
  const owner = (e.verified_owner as string) || raw.owner;

  return {
    ...base,
    name,
    operator,
    owner,
    powerMw: (e.power_capacity_mw as number) > 0 ? (e.power_capacity_mw as number) : raw.powerMw,
    sqft: (e.total_sqft as number) > 0 ? (e.total_sqft as number) : raw.sqft,
    yearOnline: (e.year_online as string) && (e.year_online as string) !== "unknown" ? (e.year_online as string) : raw.yearOnline,
    status: (e.verified_status as string) ? (e.verified_status as Datacenter["status"]) : raw.status,
    enrichment: {
      description: (e.description as string) || "",
      verified_status: (e.verified_status as string) || "",
      power_capacity_mw: (e.power_capacity_mw as number) || 0,
      total_sqft: (e.total_sqft as number) || 0,
      year_online: (e.year_online as string) || "",
      construction_update: (e.construction_update as string) || "",
      recent_news: (e.recent_news as string) || "",
      notable_tenants: (e.notable_tenants as string) || "",
      verified_name: (e.verified_name as string) || "",
      verified_operator: (e.verified_operator as string) || "",
      verified_owner: (e.verified_owner as string) || "",
      cooling_type: (e.cooling_type as string) || "",
      tier_level: (e.tier_level as string) || "",
      fiber_providers: (e.fiber_providers as string) || "",
      num_buildings: (e.num_buildings as number) || 0,
      campus_acres: (e.campus_acres as number) || 0,
      utility_provider: (e.utility_provider as string) || "",
      tax_incentives: (e.tax_incentives as string) || "",
      natural_hazard_zone: (e.natural_hazard_zone as string) || "",
      // Citations/reasoning loaded on demand from blob
      citations: [],
      reasoning: {},
      enrichedAt: "",
      runId: "",
    },
  };
});

// ─── Dedup ──────────────────────────────────────────────────────────────
// The source dataset (merged from two CSVs) contains duplicate rows for the
// same physical facility. Collapse them so each facility appears once. We key
// on the RAW name (before verified_name overwrites it) plus rounded location,
// which catches true duplicates without merging distinct buildings on one
// campus (their names carry different building numbers/letters that survive
// normalization, e.g. "PHX-07" vs "PHX-13").

function normName(n: string): string {
  return (n || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b(data|center|centre|campus|project|the|llc|inc|building)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Higher = keep. Prefers richer enrichment; penalizes divergent "dead" statuses. */
function score(dc: Datacenter): number {
  let s = 0;
  const e = dc.enrichment;
  if (e) {
    s += [
      e.description, e.notable_tenants, e.recent_news, e.construction_update,
      e.utility_provider, e.cooling_type, e.tier_level, e.fiber_providers,
      e.tax_incentives, e.natural_hazard_zone,
    ].filter(Boolean).length;
    if (e.power_capacity_mw > 0) s++;
    if (e.total_sqft > 0) s++;
  }
  if (dc.aiClassification) s += 3;
  if (dc.status === "decommissioned") s -= 5;
  if (dc.status === "unknown") s -= 3;
  return s;
}

const groups = new Map<string, Datacenter[]>();
(rawData as Datacenter[]).forEach((raw, i) => {
  const key = `${normName(raw.name)}|${raw.lat.toFixed(3)},${raw.lng.toFixed(3)}`;
  const dc = enriched[i];
  const g = groups.get(key);
  if (g) g.push(dc);
  else groups.set(key, [dc]);
});

export const datacenters: Datacenter[] = Array.from(groups.values())
  .map((g) => (g.length === 1 ? g[0] : g.slice().sort((a, b) => score(b) - score(a))[0]))
  .sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
