#!/usr/bin/env npx tsx
/**
 * End-to-end pipeline: CSV → enriched dataset with monitors + snapshots.
 *
 * Takes a raw datacenter CSV and produces:
 *   1. Clean JSON dataset (public/data/datacenters.json)
 *   2. 31 event-stream monitors watching U.S. markets
 *   3. V1 enrichment (8 fields: description, status, power, size, year, news, tenants, construction)
 *   4. V2 enrichment (17 fields: owner, cooling, tier, fiber, PUE, acres, buildings, utility, tax, hazard...)
 *   5. Compact enrichment index for the app (public/data/enrichments-compact.json)
 *   6. Per-facility enrichment files in Vercel Blob (for basis panel)
 *   7. Snapshot monitors (daily re-verification, 1d)
 *
 * Usage:
 *   PARALLEL_API_KEY=xxx npx tsx scripts/run-pipeline.ts /path/to/datacenters.csv
 *
 * Optional env vars:
 *   BLOB_READ_WRITE_TOKEN  — for uploading to Vercel Blob (step 6)
 *   WEBHOOK_URL            — for snapshot monitor webhooks (step 7)
 *
 * Each step is idempotent — re-running skips already-completed work.
 * Progress is saved after each batch so the script can be interrupted and resumed.
 */

import * as fs from "fs";
import Papa from "papaparse";
import { MONITOR_DEFS, MONITOR_OUTPUT_SCHEMA } from "./monitor-configs";

const API_KEY = process.env.PARALLEL_API_KEY;
if (!API_KEY) { console.error("Set PARALLEL_API_KEY env var."); process.exit(1); }

const BASE_URL = "https://api.parallel.ai";
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── STEP 1: CSV → JSON ─────────────────────────────────────────────

function step1_convertCsv(csvPath: string) {
  console.log("\n═══ STEP 1: Convert CSV to JSON ═══");
  const outPath = "./public/data/datacenters.json";

  if (fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    console.log(`  Already exists: ${existing.length} facilities. Skipping.`);
    return existing.length;
  }

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
    powerMw: Math.min(parseFloat(row.power_capacity_mw) || 0, 5000),
    sqft: parseFloat(row.total_sqft) || 0,
    type: row.facility_type?.trim() || "unknown",
    status: row.status?.trim() || "unknown",
    region: row._shard?.trim() || "",
  })).filter((r) => r.lat !== 0 && r.lng !== 0);

  fs.mkdirSync("./public/data", { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(cleaned));
  console.log(`  Wrote ${cleaned.length} facilities to ${outPath}`);
  return cleaned.length;
}

// ─── STEP 2: Create monitors ─────────────────────────────────────────

async function step2_setupMonitors() {
  console.log("\n═══ STEP 2: Create event-stream monitors ═══");
  const outPath = "./src/data/monitors.json";

  if (fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    const count = Object.keys(existing).length;
    if (count >= MONITOR_DEFS.length) {
      console.log(`  Already have ${count} monitors. Skipping.`);
      return count;
    }
  }

  const results: Record<string, unknown> = {};

  for (const def of MONITOR_DEFS) {
    const metadata: Record<string, string> = { demo_id: def.id, name: def.name, class: def.class };
    if (def.region) metadata.region = def.region;
    if (def.facilityCode) metadata.facilityCode = def.facilityCode;
    if (def.states) metadata.states = def.states.join(",");

    const res = await fetch(`${BASE_URL}/v1/monitors`, {
      method: "POST",
      headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "event_stream", frequency: def.frequency,
        settings: { query: def.query, processor: def.processor, output_schema: MONITOR_OUTPUT_SCHEMA },
        metadata,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      results[def.id] = { monitorId: data.monitor_id, name: def.name, class: def.class, query: def.query, frequency: def.frequency, region: def.region, facilityCode: def.facilityCode, states: def.states };
      console.log(`  ✓ ${def.id}`);
    } else {
      console.error(`  ✗ ${def.id}: ${res.status}`);
    }
  }

  fs.mkdirSync("./src/data", { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`  Created ${Object.keys(results).length} monitors`);
  return Object.keys(results).length;
}

// ─── STEP 3+4: Run enrichment (v1 or v2) ────────────────────────────

async function step_runEnrichment(version: "v1" | "v2") {
  const isV2 = version === "v2";
  console.log(`\n═══ STEP ${isV2 ? "4" : "3"}: Run ${version} enrichment (ultra2x) ═══`);

  const runsPath = isV2 ? "./src/data/enrichment-v2-runs.json" : "./src/data/enrichment-runs.json";

  if (fs.existsSync(runsPath)) {
    const existing = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
    console.log(`  Already kicked off ${existing.runs?.length || 0} runs. Skipping.`);
    return;
  }

  const dcs = JSON.parse(fs.readFileSync("./public/data/datacenters.json", "utf-8"));
  const schema = isV2 ? getV2Schema() : getV1Schema();

  const BATCH_SIZE = 1000;
  const enrichmentData: { groups: unknown[]; runs: { runId: string; groupId: string; facilityIndex: number; facilityName: string }[]; startedAt: string; processor: string; version: string; totalFacilities: number } = {
    groups: [], runs: [], startedAt: new Date().toISOString(), processor: "ultra2x", version, totalFacilities: dcs.length,
  };

  for (let batchIdx = 0; batchIdx * BATCH_SIZE < dcs.length; batchIdx++) {
    const batch = dcs.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
    const offset = batchIdx * BATCH_SIZE;

    // Create task group
    const grpRes = await fetch(`${BASE_URL}/v1/tasks/groups`, {
      method: "POST", headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { batch: String(batchIdx), type: `enrichment-${version}`, size: String(batch.length) } }),
    });
    const grp = await grpRes.json();
    enrichmentData.groups.push({ groupId: grp.taskgroup_id, batchIndex: batchIdx, size: batch.length });
    console.log(`  Group ${batchIdx + 1}: ${grp.taskgroup_id}`);

    // Submit in sub-batches of 500
    for (let j = 0; j < batch.length; j += 500) {
      const sub = batch.slice(j, j + 500);
      const inputs = sub.map((dc: Record<string, unknown>, k: number) => ({
        input: buildEnrichmentInput(dc, isV2),
        task_spec: { output_schema: schema },
        processor: "ultra2x",
        metadata: { facility_index: String(offset + j + k), facility_name: (dc.name as string).slice(0, 100), version },
      }));

      const res = await fetch(`${BASE_URL}/v1/tasks/groups/${grp.taskgroup_id}/runs`, {
        method: "POST", headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs }),
      });
      const data = await res.json();
      const runIds = data.run_ids || [];

      for (let k = 0; k < runIds.length; k++) {
        enrichmentData.runs.push({ runId: runIds[k], groupId: grp.taskgroup_id, facilityIndex: offset + j + k, facilityName: batch[j + k].name });
      }
      console.log(`    Submitted ${j + 1}-${j + sub.length}: ${runIds.length} run IDs`);
    }

    // Save immediately after each group
    fs.writeFileSync(runsPath, JSON.stringify(enrichmentData, null, 2));
  }

  console.log(`  Kicked off ${enrichmentData.runs.length} ${version} enrichment tasks`);
}

// ─── STEP 5+6: Collect results ───────────────────────────────────────

async function step_collectResults(version: "v1" | "v2") {
  const isV2 = version === "v2";
  console.log(`\n═══ STEP ${isV2 ? "6" : "5"}: Collect ${version} enrichment results ═══`);

  const runsPath = isV2 ? "./src/data/enrichment-v2-runs.json" : "./src/data/enrichment-runs.json";
  if (!fs.existsSync(runsPath)) { console.log("  No runs file found. Skipping."); return; }

  const runData = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
  const enrichPath = "./public/data/enrichments.json";
  let enrichments: Record<string, unknown> = {};
  if (fs.existsSync(enrichPath)) enrichments = JSON.parse(fs.readFileSync(enrichPath, "utf-8"));

  let collected = 0, pending = 0;

  for (let i = 0; i < runData.runs.length; i += 20) {
    const batch = runData.runs.slice(i, i + 20);
    const results = await Promise.all(batch.map(async (run: { runId: string; facilityIndex: number; facilityName: string }) => {
      const key = String(run.facilityIndex);
      // Skip if already collected (for v1) or already has v2 (for v2)
      if (!isV2 && enrichments[key]) return null;
      if (isV2 && (enrichments[key] as Record<string, unknown>)?.v2RunId) return null;

      const statusRes = await fetch(`${BASE_URL}/v1/tasks/runs/${run.runId}`, { headers: { "x-api-key": API_KEY! } });
      if (!statusRes.ok) { pending++; return null; }
      const statusData = await statusRes.json();
      if (statusData.status !== "completed") { pending++; return null; }

      const resultRes = await fetch(`${BASE_URL}/v1/tasks/runs/${run.runId}/result`, { headers: { "x-api-key": API_KEY! } });
      if (!resultRes.ok) return null;
      return { run, result: await resultRes.json() };
    }));

    for (const r of results) {
      if (!r) continue;
      const key = String(r.run.facilityIndex);
      const content = r.result?.output?.content;
      if (!content) continue;

      if (isV2 && enrichments[key]) {
        // Merge v2 into existing v1
        const existing = enrichments[key] as Record<string, unknown>;
        existing.enrichment = { ...(existing.enrichment as object), ...content };
        existing.basis = [...((existing.basis as unknown[]) || []), ...((r.result?.output?.basis || []) as unknown[])];
        existing.v2RunId = r.run.runId;
        existing.v2CollectedAt = new Date().toISOString();
      } else {
        enrichments[key] = {
          runId: r.run.runId, facilityName: r.run.facilityName, facilityIndex: r.run.facilityIndex,
          enrichment: content, basis: r.result?.output?.basis || [], collectedAt: new Date().toISOString(),
        };
      }
      collected++;
    }

    if ((i + 20) % 100 === 0 || i + 20 >= runData.runs.length) {
      fs.writeFileSync(enrichPath, JSON.stringify(enrichments, null, 2));
      process.stdout.write(`\r  Collected: ${collected} new, ${pending} pending, ${Object.keys(enrichments).length} total`);
    }
    await sleep(100);
  }

  console.log(`\n  Done: ${collected} new ${version} enrichments collected`);
  if (pending > 0) console.log(`  ${pending} still pending — re-run this script later`);
}

// ─── STEP 7: Build compact index ─────────────────────────────────────

function step7_buildCompactIndex() {
  console.log("\n═══ STEP 7: Build compact enrichment index ═══");
  const enrichPath = "./public/data/enrichments.json";
  if (!fs.existsSync(enrichPath)) { console.log("  No enrichments.json found. Skipping."); return; }

  const data = JSON.parse(fs.readFileSync(enrichPath, "utf-8"));
  const compact: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(data)) {
    const e = (entry as Record<string, unknown>).enrichment as Record<string, unknown>;
    if (!e) continue;
    compact[key] = {
      description: e.description || "", verified_status: e.verified_status || "",
      power_capacity_mw: e.power_capacity_mw || 0, total_sqft: e.total_sqft || 0,
      year_online: e.year_online || "", construction_update: e.construction_update || "",
      recent_news: e.recent_news || "", notable_tenants: e.notable_tenants || "",
      verified_name: e.verified_name || "", verified_operator: e.verified_operator || "",
      verified_owner: e.verified_owner || "", cooling_type: e.cooling_type || "",
      tier_level: e.tier_level || "", fiber_providers: e.fiber_providers || "",
      num_buildings: e.num_buildings || 0, campus_acres: e.campus_acres || 0,
      utility_provider: e.utility_provider || "", tax_incentives: e.tax_incentives || "",
      natural_hazard_zone: e.natural_hazard_zone || "",
    };
  }

  const outPath = "./public/data/enrichments-compact.json";
  fs.writeFileSync(outPath, JSON.stringify(compact, null, 0));
  const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`  Wrote compact index: ${Object.keys(compact).length} facilities (${sizeMb} MB)`);
}

// ─── STEP 8: Upload per-facility to Vercel Blob ─────────────────────

async function step8_uploadToBlob() {
  console.log("\n═══ STEP 8: Upload per-facility enrichments to Vercel Blob ═══");
  if (!BLOB_TOKEN) { console.log("  BLOB_READ_WRITE_TOKEN not set. Skipping."); return; }

  const { put } = await import("@vercel/blob");
  const data = JSON.parse(fs.readFileSync("./public/data/enrichments.json", "utf-8"));
  const keys = Object.keys(data);
  let uploaded = 0;

  for (let i = 0; i < keys.length; i += 20) {
    const batch = keys.slice(i, i + 20);
    await Promise.all(batch.map(async (key) => {
      await put(`enrichments/${key}.json`, JSON.stringify(data[key]), {
        access: "private", allowOverwrite: true, contentType: "application/json", token: BLOB_TOKEN,
      });
      uploaded++;
    }));
    process.stdout.write(`\r  ${uploaded} / ${keys.length}`);
  }
  console.log(`\n  Uploaded ${uploaded} per-facility files`);
}

// ─── STEP 9: Create snapshot monitors ────────────────────────────────

async function step9_createSnapshots() {
  console.log("\n═══ STEP 9: Create snapshot monitors ═══");
  const runsPath = "./src/data/enrichment-v2-runs.json";
  if (!fs.existsSync(runsPath)) { console.log("  No v2 runs file. Skipping."); return; }

  const snapshotPath = "./src/data/snapshot-monitors.json";
  let snapshots: Record<string, unknown> = {};
  if (fs.existsSync(snapshotPath)) snapshots = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));

  const runData = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
  let created = 0, skipped = 0;

  for (const run of runData.runs) {
    if (snapshots[String(run.facilityIndex)]) { skipped++; continue; }

    const res = await fetch(`${BASE_URL}/v1/monitors`, {
      method: "POST", headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "snapshot", frequency: "1d", processor: "base",
        settings: { task_run_id: run.runId },
        ...(WEBHOOK_URL ? { webhook: { url: WEBHOOK_URL, event_types: ["monitor.event.detected"] } } : {}),
        metadata: { facility_name: run.facilityName.slice(0, 100), facility_index: String(run.facilityIndex), type: "datacenter-snapshot" },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      snapshots[String(run.facilityIndex)] = { monitorId: data.monitor_id, runId: run.runId, facilityName: run.facilityName };
      created++;
    }

    if ((created + skipped) % 50 === 0) {
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshots, null, 2));
      process.stdout.write(`\r  Created: ${created}, Skipped: ${skipped}`);
    }
    await sleep(300); // Rate limit: ~200/min
  }

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshots, null, 2));
  console.log(`\n  Created ${created} snapshot monitors (${skipped} skipped)`);
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildEnrichmentInput(dc: Record<string, unknown>, isV2: boolean): string {
  const parts = [
    `Facility: ${dc.name}`, `Operator: ${dc.operator}`,
    dc.owner !== dc.operator ? `Owner: ${dc.owner}` : "",
    `Location: ${dc.address}, ${dc.city}, ${dc.state}`,
    `Type: ${dc.type}`, `Status: ${dc.status}`,
    (dc.powerMw as number) > 0 ? `Power: ${dc.powerMw} MW` : "",
    (dc.sqft as number) > 0 ? `Size: ${dc.sqft} sq ft` : "",
  ].filter(Boolean).join("\n");

  if (isV2) {
    return `Research this U.S. data center facility thoroughly and provide detailed technical, financial, and risk information:\n\n${parts}\n\nVerify the facility name, operator, and owner. Find technical specs (cooling, tier, backup power, fiber, PUE), land and expansion details, financial signals (investment cost, utility provider, tax incentives), and risk factors (water source, natural hazards, community opposition).`;
  }
  return `Research this U.S. data center facility and provide verified, current information:\n\n${parts}\n\nVerify or correct all fields. Find the actual power capacity, square footage, and year online if not listed. Check for recent news, construction updates, and notable tenants.`;
}

function getV1Schema() {
  return {
    type: "json" as const, json_schema: {
      type: "object" as const,
      properties: {
        description: { type: "string" as const, description: "1-2 sentence summary of the facility" },
        verified_status: { type: "string" as const, enum: ["operational", "under-construction", "planned", "decommissioned"] },
        power_capacity_mw: { type: "number" as const, description: "Total power in MW. 0 if unknown." },
        total_sqft: { type: "number" as const, description: "Total footprint in sq ft. 0 if unknown." },
        year_online: { type: "string" as const, description: "Year online or expected. 'unknown' if indeterminate." },
        construction_update: { type: "string" as const, description: "Latest construction milestone. Empty if operational." },
        recent_news: { type: "string" as const, description: "Most notable recent development (last 6 months). Empty if none." },
        notable_tenants: { type: "string" as const, description: "Known anchor tenants. Empty if unknown." },
      },
      required: ["description", "verified_status", "power_capacity_mw", "total_sqft", "year_online", "construction_update", "recent_news", "notable_tenants"],
      additionalProperties: false,
    },
  };
}

function getV2Schema() {
  return {
    type: "json" as const, json_schema: {
      type: "object" as const,
      properties: {
        verified_name: { type: "string" as const, description: "Correct, current facility name." },
        verified_operator: { type: "string" as const, description: "Current operating company." },
        verified_owner: { type: "string" as const, description: "Real estate owner (REIT, PE fund). Empty if unknown." },
        cooling_type: { type: "string" as const, description: "Primary cooling: air-cooled, evaporative, chilled water, liquid, hybrid, unknown." },
        tier_level: { type: "string" as const, description: "Uptime Institute tier. Empty if not certified." },
        backup_power_mw: { type: "number" as const, description: "Generator capacity in MW. 0 if unknown." },
        fiber_providers: { type: "string" as const, description: "Major fiber providers or 'carrier-neutral'. Empty if unknown." },
        pue: { type: "number" as const, description: "Power Usage Effectiveness. 0 if unreported." },
        campus_acres: { type: "number" as const, description: "Total campus area in acres. 0 if unknown." },
        expansion_capacity_mw: { type: "number" as const, description: "Planned expansion MW. 0 if none." },
        num_buildings: { type: "number" as const, description: "Number of DC buildings/phases. 0 if unknown." },
        estimated_investment_usd: { type: "number" as const, description: "Total project investment in USD. 0 if unknown." },
        utility_provider: { type: "string" as const, description: "Primary electric utility. Empty if unknown." },
        tax_incentives: { type: "string" as const, description: "Active tax incentives. Empty if none." },
        water_source: { type: "string" as const, description: "Primary water source: municipal, groundwater, recycled, air-cooled, unknown." },
        natural_hazard_zone: { type: "string" as const, description: "FEMA flood zone, seismic, hurricane, or 'low risk'. Empty if unknown." },
        community_opposition: { type: "string" as const, description: "Opposition or litigation. Empty if none." },
      },
      required: ["verified_name", "verified_operator", "verified_owner", "cooling_type", "tier_level", "backup_power_mw", "fiber_providers", "pue", "campus_acres", "expansion_capacity_mw", "num_buildings", "estimated_investment_usd", "utility_provider", "tax_incentives", "water_source", "natural_hazard_zone", "community_opposition"],
      additionalProperties: false,
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: PARALLEL_API_KEY=xxx npx tsx scripts/run-pipeline.ts /path/to/datacenters.csv");
    console.error("\nOptional env vars:");
    console.error("  BLOB_READ_WRITE_TOKEN  — upload to Vercel Blob");
    console.error("  WEBHOOK_URL            — snapshot monitor webhooks");
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) { console.error(`CSV not found: ${csvPath}`); process.exit(1); }

  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  Datacenter Monitor — E2E Pipeline            ║");
  console.log("╚═══════════════════════════════════════════════╝");
  console.log(`  CSV: ${csvPath}`);
  console.log(`  API Key: ${API_KEY!.slice(0, 8)}...`);
  console.log(`  Blob: ${BLOB_TOKEN ? "configured" : "not set (skip upload)"}`);
  console.log(`  Webhook: ${WEBHOOK_URL || "not set (skip snapshot webhooks)"}`);

  const startTime = Date.now();

  // Step 1: CSV → JSON
  const facilityCount = step1_convertCsv(csvPath);

  // Step 2: Create monitors (parallel with enrichment)
  await step2_setupMonitors();

  // Step 3: Kick off v1 enrichment
  await step_runEnrichment("v1");

  // Step 4: Kick off v2 enrichment (can run in parallel with v1)
  await step_runEnrichment("v2");

  // Step 5: Collect v1 results (poll until done or pending)
  await step_collectResults("v1");

  // Step 6: Collect v2 results and merge
  await step_collectResults("v2");

  // Step 7: Build compact index for the app
  step7_buildCompactIndex();

  // Step 8: Upload per-facility to Vercel Blob
  if (BLOB_TOKEN) await step8_uploadToBlob();

  // Step 9: Create snapshot monitors
  await step9_createSnapshots();

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n╔═══════════════════════════════════════════════╗`);
  console.log(`║  Pipeline complete in ${elapsed}s                     `);
  console.log(`║  ${facilityCount} facilities enriched                 `);
  console.log(`║  ${MONITOR_DEFS.length} event-stream monitors created         `);
  console.log(`║  Run 'npm run dev' to see the app              `);
  console.log(`╚═══════════════════════════════════════════════╝`);
}

main().catch(console.error);
