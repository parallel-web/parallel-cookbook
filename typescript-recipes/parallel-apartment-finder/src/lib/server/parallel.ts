// Parallel FindAll API client + prompt definitions. Each function is a single
// short HTTP call — serverless-friendly.

import {
  BLOCKED_DOMAINS, CITY_SHORT,
  FINDALL_GENERATOR, FINDALL_MATCH_LIMIT, FINDALL_ENRICH_PROCESSOR,
} from "./config"

const API_BASE = process.env.PARALLEL_API_BASE ?? "https://api.parallel.ai"
const FINDALL_BETA = "findall-2025-09-15"

function headers(beta = true): Record<string, string> {
  const key = process.env.PARALLEL_API_KEY
  if (!key) throw new Error("PARALLEL_API_KEY is not set")
  const h: Record<string, string> = {
    "x-api-key": key,
    "Content-Type": "application/json",
  }
  if (beta) h["parallel-beta"] = FINDALL_BETA
  return h
}

async function parallelFetch(path: string, init?: RequestInit, beta = true): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: headers(beta) })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Parallel API ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// ── FindAll match conditions ─────────────────────────────────────────────

function matchConditions(minBeds: number | null, budget: number, city: string) {
  let blockedClause = ""
  if (BLOCKED_DOMAINS.length) {
    const listed = BLOCKED_DOMAINS.join(", ")
    blockedClause =
      ` Reject any candidate whose URL is on these domains: ${listed}. ` +
      `Prefer the original landlord's, broker's, or property-management website ` +
      `over those aggregators.`
  }
  return [
    {
      name: "is_rental_listing",
      description:
        `The page is one individual rental unit's own listing page in or near ${city}, ` +
        "reachable at its own URL and showing a specific street address. " +
        "Reject search-results pages, neighborhood or price category/index pages, " +
        "pages that list many different properties, directory or map pages, and " +
        "news articles." +
        blockedClause +
        " Mark matched only for a single specific unit's listing on a non-blocked " +
        "domain; if the page is a search, category, or multi-property list, mark it not matched.",
    },
    {
      name: "fits_budget",
      description:
        `The asking monthly rent is at or below $${budget} US dollars. ` +
        "If the rent is not shown on the page, treat this as matched (do not reject for missing data).",
    },
  ]
}

// ── Enrichment field definitions ─────────────────────────────────────────
// Entity → Action → Specifics → Error handling; "" is the unknown sentinel.

const ENRICHMENTS: { name: string; description: string }[] = [
  { name: "street_address", description:
      "Entity: this rental listing's unit address. " +
      "Action: extract the exact street address as written on the page. " +
      "Specifics: include unit/apt number if shown (e.g. '123 Main St #4'); " +
      "do not include city, state, or zip. " +
      "If only a neighborhood or no street address is shown, return an empty string." },
  { name: "monthly_rent_usd", description:
      "Entity: this rental unit's asking monthly rent. " +
      "Action: extract the listed monthly rent. " +
      "Specifics: an integer in US dollars, no '$' sign, no commas, no '/mo' " +
      "suffix (e.g. '4500' for $4,500/month). Use the headline rent, NOT a " +
      "deposit, application fee, security deposit, or 'starting at' range minimum. " +
      "Do NOT confuse the rent with the street number of the address, the zip " +
      "code, the year built, or square footage. " +
      "If no monthly rent is shown on the page, return an empty string." },
  { name: "bedrooms", description:
      "Entity: this rental unit. " +
      "Action: extract the bedroom count of the unit being advertised. " +
      "Specifics: an integer (e.g. '0' for studio, '3' for a 3-bedroom). " +
      "Pick the number for the specific unit; do not return a range or " +
      "the bedroom counts of other units in the same building. " +
      "If the bedroom count is not shown, return an empty string." },
  { name: "bathrooms", description:
      "Entity: this rental unit. " +
      "Action: extract the bathroom count. " +
      "Specifics: as a decimal number (e.g. '1', '1.5', '2.5'). " +
      "If the page does not state a bathroom count, return an empty string." },
  { name: "square_feet", description:
      "Entity: this rental unit. " +
      "Action: extract the interior square footage. " +
      "Specifics: as an integer with no commas or 'sqft' suffix (e.g. '1200'). " +
      "If the page does not state square footage, return an empty string." },
  { name: "available_date", description:
      "Entity: this rental unit's first move-in date. " +
      "Action: extract the date the unit is or becomes available. " +
      "Specifics: prefer ISO format YYYY-MM-DD if a specific date is shown. " +
      "Otherwise return one of these phrases verbatim: 'available now', " +
      "'available immediately', or 'available soon'. " +
      "If no availability information appears, return an empty string." },
  { name: "lease_term", description:
      "Entity: this rental unit's lease length. " +
      "Action: extract the lease length and type. " +
      "Specifics: short phrase (e.g. '12-month', 'month-to-month', " +
      "'6-month minimum', 'flexible'). " +
      "If no lease term is mentioned, return an empty string." },
  { name: "pet_policy", description:
      "Entity: this rental unit's pet policy. " +
      "Action: extract whether pets are allowed and any restrictions. " +
      "Specifics: short phrase (e.g. 'Cats OK, no dogs', 'No pets', " +
      "'Dogs under 25lb', 'Pets allowed'). " +
      "If pets are not mentioned at all, return an empty string." },
  { name: "is_furnished", description:
      "Entity: this rental unit. " +
      "Action: classify the furnishing status. " +
      "Specifics: return one of exactly: 'furnished', 'partially furnished', " +
      "'unfurnished'. " +
      "If furnishing isn't mentioned, return an empty string." },
  { name: "utilities_included", description:
      "Entity: this rental unit. " +
      "Action: extract which utilities are included in rent. " +
      "Specifics: comma-separated list (e.g. 'water, trash', 'all included', " +
      "'none included'). " +
      "If utilities are not mentioned, return an empty string." },
  { name: "parking_type", description:
      "Entity: this rental unit. " +
      "Action: classify the parking situation. " +
      "Specifics: short phrase (e.g. 'garage included', '1 covered spot', " +
      "'street only', 'no parking', 'extra $200/mo'). " +
      "If parking is not mentioned, return an empty string." },
  { name: "laundry_type", description:
      "Entity: this rental unit. " +
      "Action: classify the laundry situation. " +
      "Specifics: short phrase (e.g. 'in-unit washer/dryer', " +
      "'shared on floor', 'coin-op in basement', 'none'). " +
      "If laundry is not mentioned, return an empty string." },
  { name: "building_amenities", description:
      "Entity: the building or property containing this unit. " +
      "Action: extract building-level amenities (not unit-specific). " +
      "Specifics: comma-separated list of features (e.g. " +
      "'gym, rooftop, doorman, elevator, pool'). Exclude utilities and " +
      "in-unit features. " +
      "If no building amenities are listed, return an empty string." },
  { name: "neighborhood", description:
      "Entity: the city neighborhood of this unit. " +
      "Action: extract the specific neighborhood name. " +
      "Specifics: a single name like 'Downtown', 'Midtown', 'Old Town'; " +
      "do not return the city or zip code. " +
      "If only the city is mentioned, return an empty string." },
  { name: "contact_phone", description:
      "Entity: the contact for this listing. " +
      "Action: extract a phone number to inquire about the unit. " +
      "Specifics: plain digits with separators (e.g. '(555) 555-1234'). " +
      "If no phone number is shown on the page, return an empty string." },
  { name: "contact_email", description:
      "Entity: the contact for this listing. " +
      "Action: extract an email address to inquire about the unit. " +
      "Specifics: a single email address (e.g. 'leasing@example.com'). " +
      "If no email is shown on the page, return an empty string." },
  { name: "is_currently_active", description:
      "Entity: the listing status of this rental unit. " +
      "Action: determine whether the unit is currently being actively marketed. " +
      "Specifics: return 'yes' if the page shows this unit is available to rent right now. " +
      "Return 'no' if the page indicates the unit is leased, rented, pending, off-market, " +
      "no-longer-available, or 'this listing has been removed'. " +
      "If the page is reachable and shows a normal listing without a removed/rented " +
      "status banner, return 'yes' (assume listed because it's findable)." },
  { name: "days_on_market", description:
      "Entity: this rental listing. " +
      "Action: extract how many days the unit has been on the market. " +
      "Specifics: an integer (e.g. '7'). Use 'days on market', 'listed N days ago', " +
      "'posted N days ago', or compute from a 'first listed' / 'posted on' date. " +
      "If only a posted date is shown without an explicit count, compute the days " +
      "between that date and today. " +
      "If no posted date or days-on-market is shown anywhere, return an empty string." },
]

// FindAll returns only match-condition fields inline; the per-listing facts
// come from a dedicated enrichment pass whose schema mirrors ENRICHMENTS.
function enrichmentOutputSchema() {
  const properties: Record<string, { type: string; description: string }> = {}
  for (const e of ENRICHMENTS) {
    properties[e.name] = { type: "string", description: e.description }
  }
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  }
}

// ── API calls ────────────────────────────────────────────────────────────

export interface FindAllCreateResult {
  findallId: string
  objective: string
}

export async function findallCreate(opts: {
  query: string
  budget: number
  city?: string | null
  requirements?: string | null
  neighborhoods?: string[] | null
  sources?: string[] | null
  minBeds?: number | null
}): Promise<FindAllCreateResult> {
  const city = opts.city?.trim() || CITY_SHORT
  // 0 is studio (not "unset"), so express it explicitly rather than dropping it.
  const bedsStr =
    opts.minBeds == null ? "" :
    opts.minBeds === 0 ? "studio " :
    `${opts.minBeds} bedroom `
  let objective =
    `Find ${bedsStr}apartments for rent ` +
    `under ${opts.budget} dollars per month in ${city}`
  if (opts.query && !opts.query.toLowerCase().includes(city.toLowerCase())) {
    objective += `. ${opts.query}`
  }
  if (opts.neighborhoods?.length) {
    objective += `. Prioritize listings in these ${city} neighborhoods: ${opts.neighborhoods.join(", ")}`
  }
  if (opts.sources?.length) {
    objective += `. Search the web broadly, and be sure to include listings from these websites: ${opts.sources.join(", ")}`
  }
  if (opts.requirements) objective += `. Requirements: ${opts.requirements}`
  // Steer the generator toward real inventory: individual unit pages, not the
  // search/category index pages that otherwise fill most of the verified slots.
  objective += ". Return individual rental listing pages, each with its own URL and street address; do not return search-results, category, or neighborhood index pages."

  const data = await parallelFetch("/v1beta/findall/runs", {
    method: "POST",
    body: JSON.stringify({
      objective,
      entity_type: "apartment rental listings",
      match_conditions: matchConditions(opts.minBeds ?? null, opts.budget, city),
      enrichments: ENRICHMENTS,
      generator: FINDALL_GENERATOR,
      match_limit: FINDALL_MATCH_LIMIT,
    }),
  }) as Record<string, unknown>

  const findallId = (data.findall_id ?? data.run_id) as string | undefined
  if (!findallId) throw new Error("FindAll create returned no id")
  return { findallId, objective }
}

export interface FindAllStatus {
  state: string
  generated: number
  matched: number
}

export async function findallStatus(findallId: string): Promise<FindAllStatus> {
  const data = await parallelFetch(`/v1beta/findall/runs/${findallId}`) as Record<string, unknown>
  const statusObj = data.status
  let state: string
  let metrics: Record<string, number>
  if (statusObj && typeof statusObj === "object") {
    const s = statusObj as Record<string, unknown>
    state = (s.status as string) ?? ""
    metrics = (s.metrics as Record<string, number>) ?? {}
  } else {
    state = (statusObj as string) ?? ""
    metrics = (data.metrics as Record<string, number>) ?? {}
  }
  return {
    state,
    generated: metrics.generated_candidates_count ?? 0,
    matched: metrics.matched_candidates_count ?? 0,
  }
}

export interface Candidate {
  name?: string
  url?: string
  description?: string
  match_status?: string
  output?: Record<string, { value?: unknown; type?: string; is_matched?: boolean }>
  basis?: { citations?: { url?: string; title?: string }[] }[]
}

export async function findallResult(findallId: string): Promise<Candidate[]> {
  const data = await parallelFetch(`/v1beta/findall/runs/${findallId}/result`) as Record<string, unknown>
  const candidates = (data.candidates ?? []) as Candidate[]
  return candidates.filter((c) => c.match_status === "matched")
}

export async function findallEnrich(findallId: string): Promise<void> {
  await parallelFetch(`/v1beta/findall/runs/${findallId}/enrich`, {
    method: "POST",
    body: JSON.stringify({
      processor: FINDALL_ENRICH_PROCESSOR,
      output_schema: { type: "json", json_schema: enrichmentOutputSchema() },
    }),
  })
}

// ── Task API (per-listing secondary verification) ────────────────────────

export async function taskCreate(
  inputData: Record<string, unknown>,
  outputSchema: Record<string, unknown>,
  processor: string,
): Promise<string> {
  const data = await parallelFetch("/v1/tasks/runs", {
    method: "POST",
    body: JSON.stringify({
      input: inputData,
      task_spec: { output_schema: { type: "json", json_schema: outputSchema } },
      processor,
    }),
  }, false) as Record<string, unknown>
  const runId = data.run_id as string | undefined
  if (!runId) throw new Error("Task create returned no run_id")
  return runId
}

export async function taskStatus(runId: string): Promise<string> {
  const data = await parallelFetch(`/v1/tasks/runs/${runId}`, undefined, false) as Record<string, unknown>
  const s = data.status
  if (s && typeof s === "object") return ((s as Record<string, unknown>).status as string) ?? ""
  return (s as string) ?? ""
}

export async function taskResult(runId: string): Promise<Record<string, unknown>> {
  const data = await parallelFetch(`/v1/tasks/runs/${runId}/result`, undefined, false) as Record<string, unknown>
  const output = (data.output ?? {}) as Record<string, unknown>
  return (output.content ?? {}) as Record<string, unknown>
}
