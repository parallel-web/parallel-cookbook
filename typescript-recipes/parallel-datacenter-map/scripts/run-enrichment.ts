/**
 * Enriches all 1,939 datacenters via Task API using Task Groups.
 * Uses ultra2x processor for maximum depth.
 * Saves run IDs IMMEDIATELY at kickoff (not after completion).
 *
 * Usage: npx tsx scripts/run-enrichment.ts
 */

import * as fs from "fs";

const API_KEY =
  process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";

const ENRICHMENT_SCHEMA = {
  type: "json" as const,
  json_schema: {
    type: "object" as const,
    properties: {
      description: {
        type: "string" as const,
        description:
          "1-2 sentence summary of the facility: what it is, who operates it, and what is notable about it",
      },
      verified_status: {
        type: "string" as const,
        description:
          "Current operational status based on latest available information",
        enum: ["operational", "under-construction", "planned", "decommissioned"],
      },
      power_capacity_mw: {
        type: "number" as const,
        description:
          "Total power capacity in megawatts. Use 0 if not determinable.",
      },
      total_sqft: {
        type: "number" as const,
        description:
          "Total facility footprint in square feet. Use 0 if not determinable.",
      },
      year_online: {
        type: "string" as const,
        description:
          "Year the facility came online or is expected to come online. Use 'unknown' if not determinable.",
      },
      construction_update: {
        type: "string" as const,
        description:
          "Latest construction or development milestone with date, if facility is under construction or planned. Empty string if operational and no active expansion.",
      },
      recent_news: {
        type: "string" as const,
        description:
          "Most notable recent development about this facility (last 6 months): expansion, new tenant, opposition, regulatory action. Empty string if no recent news found.",
      },
      notable_tenants: {
        type: "string" as const,
        description:
          "Known anchor tenants or major customers. Empty string if not publicly known.",
      },
    },
    required: [
      "description",
      "verified_status",
      "power_capacity_mw",
      "total_sqft",
      "year_online",
      "construction_update",
      "recent_news",
      "notable_tenants",
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
    `Current listed status: ${dc.status}`,
    dc.powerMw > 0 ? `Listed power: ${dc.powerMw} MW` : "",
    dc.sqft > 0 ? `Listed size: ${dc.sqft} sq ft` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `Research this U.S. data center facility and provide verified, current information:\n\n${parts}\n\nVerify or correct all fields. Find the actual power capacity, square footage, and year online if not listed. Check for recent news, construction updates, and notable tenants.`;
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
  if (!res.ok) {
    throw new Error(`Failed to create task group: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.taskgroup_id;
}

interface RunSpec {
  input: string;
  task_spec: { output_schema: typeof ENRICHMENT_SCHEMA };
  processor: string;
  metadata: Record<string, string>;
}

async function submitBatchRuns(
  groupId: string,
  runs: RunSpec[]
): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/v1/tasks/groups/${groupId}/runs`, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: runs }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to submit batch: ${res.status} ${await res.text()}`
    );
  }
  const data = await res.json();
  return data.run_ids || [];
}

async function main() {
  // Load datacenters
  const dcs: Datacenter[] = JSON.parse(
    fs.readFileSync("./public/data/datacenters.json", "utf-8")
  );
  console.log(`Enriching ${dcs.length} datacenters with ultra2x...\n`);

  // Split into groups of 1000
  const BATCH_SIZE = 1000;
  const batches: Datacenter[][] = [];
  for (let i = 0; i < dcs.length; i += BATCH_SIZE) {
    batches.push(dcs.slice(i, i + BATCH_SIZE));
  }
  console.log(`Split into ${batches.length} task groups\n`);

  // Track everything for immediate save
  const enrichmentData: {
    groups: { groupId: string; batchIndex: number; size: number }[];
    runs: {
      runId: string;
      groupId: string;
      facilityIndex: number;
      facilityName: string;
    }[];
    startedAt: string;
    processor: string;
    totalFacilities: number;
  } = {
    groups: [],
    runs: [],
    startedAt: new Date().toISOString(),
    processor: "ultra2x",
    totalFacilities: dcs.length,
  };

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const globalOffset = batchIdx * BATCH_SIZE;

    // Create task group
    console.log(
      `Creating task group ${batchIdx + 1}/${batches.length} (${batch.length} facilities)...`
    );
    const groupId = await createTaskGroup({
      batch: String(batchIdx),
      type: "datacenter-enrichment",
      size: String(batch.length),
    });
    console.log(`  Group ID: ${groupId}`);

    enrichmentData.groups.push({
      groupId,
      batchIndex: batchIdx,
      size: batch.length,
    });

    // Build run specs
    const runSpecs: RunSpec[] = batch.map((dc, i) => ({
      input: buildInput(dc),
      task_spec: { output_schema: ENRICHMENT_SCHEMA },
      processor: "ultra2x",
      metadata: {
        facility_index: String(globalOffset + i),
        facility_name: dc.name.slice(0, 100),
      },
    }));

    // Submit in sub-batches of 500 to be safe
    const SUB_BATCH = 500;
    for (let j = 0; j < runSpecs.length; j += SUB_BATCH) {
      const subBatch = runSpecs.slice(j, j + SUB_BATCH);
      console.log(
        `  Submitting runs ${j + 1}-${j + subBatch.length} of ${runSpecs.length}...`
      );

      const runIds = await submitBatchRuns(groupId, subBatch);

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

    // SAVE IMMEDIATELY after each group
    fs.writeFileSync(
      "./src/data/enrichment-runs.json",
      JSON.stringify(enrichmentData, null, 2)
    );
    console.log(
      `  Saved ${enrichmentData.runs.length} run IDs to src/data/enrichment-runs.json\n`
    );
  }

  console.log(`\n=== KICKOFF COMPLETE ===`);
  console.log(`Groups: ${enrichmentData.groups.length}`);
  console.log(`Runs: ${enrichmentData.runs.length}`);
  console.log(`Processor: ultra2x`);
  console.log(`All run IDs saved to src/data/enrichment-runs.json`);
  console.log(`\nRun 'npx tsx scripts/collect-enrichments.ts' to collect results once complete.`);

  // Poll for group status
  console.log(`\nPolling group status...`);
  for (const group of enrichmentData.groups) {
    const res = await fetch(
      `${BASE_URL}/v1/tasks/groups/${group.groupId}`,
      { headers: { "x-api-key": API_KEY } }
    );
    if (res.ok) {
      const data = await res.json();
      console.log(
        `  Group ${group.groupId}: ${JSON.stringify(data.status)}`
      );
    }
  }
}

main().catch(console.error);
