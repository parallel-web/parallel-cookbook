/**
 * Second enrichment pass — expands the dataset with 15+ additional fields.
 * Confirms operator/owner/name and adds technical, financial, land, and risk data.
 * Uses ultra2x processor via Task Groups.
 *
 * Usage: npx tsx scripts/run-enrichment-v2.ts
 */

import * as fs from "fs";

const API_KEY =
  process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";

const ENRICHMENT_V2_SCHEMA = {
  type: "json" as const,
  json_schema: {
    type: "object" as const,
    properties: {
      // Identity verification
      verified_name: {
        type: "string" as const,
        description:
          "The correct, current facility name. Correct any errors in the provided name.",
      },
      verified_operator: {
        type: "string" as const,
        description:
          "The company that currently operates this facility. May differ from owner.",
      },
      verified_owner: {
        type: "string" as const,
        description:
          "The company or entity that owns the real estate asset (e.g., Digital Realty Trust, Blackstone/QTS, Brookfield). This is often a REIT, PE fund, or JV — not the operator. Use empty string if not determinable.",
      },

      // Technical specs
      cooling_type: {
        type: "string" as const,
        description:
          "Primary cooling technology: air-cooled, evaporative, chilled water, liquid cooling, hybrid, or unknown.",
      },
      tier_level: {
        type: "string" as const,
        description:
          "Uptime Institute Tier certification level (Tier I, Tier II, Tier III, Tier IV) or equivalent design standard. Empty string if not certified or not determinable.",
      },
      backup_power_mw: {
        type: "number" as const,
        description:
          "Backup/generator power capacity in MW. Use 0 if not determinable.",
      },
      fiber_providers: {
        type: "string" as const,
        description:
          "Major fiber/network providers connected to this facility, or 'carrier-neutral' if applicable. Empty string if not determinable.",
      },
      pue: {
        type: "number" as const,
        description:
          "Power Usage Effectiveness ratio if publicly reported (e.g., 1.2). Use 0 if not determinable.",
      },

      // Land & expansion
      campus_acres: {
        type: "number" as const,
        description:
          "Total campus or land area in acres. Use 0 if not determinable.",
      },
      expansion_capacity_mw: {
        type: "number" as const,
        description:
          "Planned or permitted expansion capacity in MW beyond current capacity. Use 0 if none or not determinable.",
      },
      num_buildings: {
        type: "number" as const,
        description:
          "Number of data center buildings or phases on this campus. Use 0 if not determinable.",
      },

      // Financial signals
      estimated_investment_usd: {
        type: "number" as const,
        description:
          "Estimated total project investment in USD if publicly reported (e.g., 500000000 for $500M). Use 0 if not determinable.",
      },
      utility_provider: {
        type: "string" as const,
        description:
          "Primary electric utility serving this facility (e.g., Dominion Energy, PG&E, ComEd). Empty string if not determinable.",
      },
      tax_incentives: {
        type: "string" as const,
        description:
          "Any active state or local tax incentives, abatements, or enterprise zone benefits. Empty string if none or not determinable.",
      },

      // Risk
      water_source: {
        type: "string" as const,
        description:
          "Primary water source for cooling: municipal, groundwater/well, recycled/reclaimed, air-cooled (no water), or unknown.",
      },
      natural_hazard_zone: {
        type: "string" as const,
        description:
          "Notable natural hazard exposure: FEMA flood zone designation, seismic zone, hurricane zone, or 'low risk' if none identified. Empty string if not determinable.",
      },
      community_opposition: {
        type: "string" as const,
        description:
          "Any organized community opposition, litigation, or political controversy affecting this facility. Empty string if none found.",
      },
    },
    required: [
      "verified_name",
      "verified_operator",
      "verified_owner",
      "cooling_type",
      "tier_level",
      "backup_power_mw",
      "fiber_providers",
      "pue",
      "campus_acres",
      "expansion_capacity_mw",
      "num_buildings",
      "estimated_investment_usd",
      "utility_provider",
      "tax_incentives",
      "water_source",
      "natural_hazard_zone",
      "community_opposition",
    ],
    additionalProperties: false,
  },
};

interface Datacenter {
  name: string;
  operator: string;
  owner: string;
  address: string;
  city: string;
  state: string;
  type: string;
  status: string;
  powerMw: number;
  sqft: number;
}

function buildInput(dc: Datacenter): string {
  const parts = [
    `Facility: ${dc.name}`,
    `Operator: ${dc.operator}`,
    dc.owner !== dc.operator ? `Owner: ${dc.owner}` : "",
    `Location: ${dc.address}, ${dc.city}, ${dc.state}`,
    `Type: ${dc.type}`,
    `Status: ${dc.status}`,
    dc.powerMw > 0 ? `Power: ${dc.powerMw} MW` : "",
    dc.sqft > 0 ? `Size: ${dc.sqft} sq ft` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `Research this U.S. data center facility thoroughly and provide detailed technical, financial, and risk information:\n\n${parts}\n\nVerify the facility name, operator, and owner (owner may differ from operator — look for the REIT, PE fund, or real estate entity that owns the asset). Find technical specs (cooling, tier, backup power, fiber, PUE), land and expansion details, financial signals (investment cost, utility provider, tax incentives), and risk factors (water source, natural hazards, community opposition).`;
}

async function createTaskGroup(
  metadata: Record<string, string>
): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/tasks/groups`, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ metadata }),
  });
  if (!res.ok)
    throw new Error(
      `Failed to create task group: ${res.status} ${await res.text()}`
    );
  const data = await res.json();
  return data.taskgroup_id;
}

async function submitBatch(
  groupId: string,
  runs: { input: string; task_spec: unknown; processor: string; metadata: Record<string, string> }[]
): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/v1/tasks/groups/${groupId}/runs`, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: runs }),
  });
  if (!res.ok)
    throw new Error(
      `Failed to submit batch: ${res.status} ${await res.text()}`
    );
  const data = await res.json();
  return data.run_ids || [];
}

async function main() {
  const dcs: Datacenter[] = JSON.parse(
    fs.readFileSync("./public/data/datacenters.json", "utf-8")
  );
  console.log(`Enrichment v2: ${dcs.length} datacenters with ultra2x\n`);

  const BATCH_SIZE = 1000;
  const batches: Datacenter[][] = [];
  for (let i = 0; i < dcs.length; i += BATCH_SIZE) {
    batches.push(dcs.slice(i, i + BATCH_SIZE));
  }

  const enrichmentData: {
    groups: { groupId: string; batchIndex: number; size: number }[];
    runs: { runId: string; groupId: string; facilityIndex: number; facilityName: string }[];
    startedAt: string;
    processor: string;
    version: string;
    totalFacilities: number;
  } = {
    groups: [],
    runs: [],
    startedAt: new Date().toISOString(),
    processor: "ultra2x",
    version: "v2",
    totalFacilities: dcs.length,
  };

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const globalOffset = batchIdx * BATCH_SIZE;

    console.log(
      `Creating task group ${batchIdx + 1}/${batches.length} (${batch.length} facilities)...`
    );
    const groupId = await createTaskGroup({
      batch: String(batchIdx),
      type: "datacenter-enrichment-v2",
      size: String(batch.length),
    });
    console.log(`  Group ID: ${groupId}`);
    enrichmentData.groups.push({ groupId, batchIndex: batchIdx, size: batch.length });

    const SUB_BATCH = 500;
    for (let j = 0; j < batch.length; j += SUB_BATCH) {
      const sub = batch.slice(j, j + SUB_BATCH);
      console.log(`  Submitting runs ${j + 1}-${j + sub.length}...`);

      const specs = sub.map((dc, k) => ({
        input: buildInput(dc),
        task_spec: { output_schema: ENRICHMENT_V2_SCHEMA },
        processor: "ultra2x",
        metadata: {
          facility_index: String(globalOffset + j + k),
          facility_name: dc.name.slice(0, 100),
          version: "v2",
        },
      }));

      const runIds = await submitBatch(groupId, specs);
      for (let k = 0; k < runIds.length; k++) {
        enrichmentData.runs.push({
          runId: runIds[k],
          groupId,
          facilityIndex: globalOffset + j + k,
          facilityName: batch[j + k].name,
        });
      }
      console.log(`    Got ${runIds.length} run IDs`);
    }

    // Save immediately after each group
    fs.writeFileSync(
      "./src/data/enrichment-v2-runs.json",
      JSON.stringify(enrichmentData, null, 2)
    );
    console.log(`  Saved ${enrichmentData.runs.length} run IDs\n`);
  }

  console.log(`\n=== KICKOFF COMPLETE ===`);
  console.log(`Groups: ${enrichmentData.groups.length}`);
  console.log(`Runs: ${enrichmentData.runs.length}`);
  console.log(`Processor: ultra2x`);
  console.log(`Schema: v2 (17 new fields)`);
  console.log(`All run IDs saved to src/data/enrichment-v2-runs.json`);

  // Poll status
  console.log(`\nPolling group status...`);
  for (const group of enrichmentData.groups) {
    const res = await fetch(`${BASE_URL}/v1/tasks/groups/${group.groupId}`, {
      headers: { "x-api-key": API_KEY },
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`  Group ${group.groupId}: ${JSON.stringify(data.status?.task_run_status_counts)}`);
    }
  }
}

main().catch(console.error);
