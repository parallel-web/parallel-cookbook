#!/usr/bin/env npx tsx
/**
 * AI datacenter classification: which facilities are AI datacenters, and what
 * are their environmental/community impact classifications (water, grid,
 * community) — à la brockovichdatacenter.com, scoped to AI facilities.
 *
 * Candidates: facilities with AI/GPU/hyperscale signals in existing enrichment,
 * ≥100 MW power, or AI-heavy operators/owners (~700 of 2,811).
 *
 * Usage:
 *   PARALLEL_API_KEY=xxx npx tsx scripts/classify-ai.ts kickoff   # start task group
 *   PARALLEL_API_KEY=xxx npx tsx scripts/classify-ai.ts collect   # poll + save results
 *
 * Both steps are idempotent and resumable. Run IDs are saved at kickoff to
 * src/data/ai-classification-runs.json; results land in
 * public/data/ai-classifications.json keyed by facility index.
 */

import * as fs from "fs";

const API_KEY = process.env.PARALLEL_API_KEY;
if (!API_KEY) { console.error("Set PARALLEL_API_KEY env var."); process.exit(1); }

const BASE_URL = "https://api.parallel.ai";
const RUNS_PATH = "./src/data/ai-classification-runs.json";
const OUT_PATH = "./public/data/ai-classifications.json";
const PROCESSOR = "ultra2x";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const AI_OPERATORS = /microsoft|azure|google|meta|amazon|aws|oracle|openai|xai|x\.ai|coreweave|crusoe|lambda|nvidia|anthropic|tesla|applied digital|core scientific|cipher|terawulf|vantage|switch|aligned|stack infra|qts|compass|cyrusone|novva|edged|prime data|colovore/i;
const AI_SIGNALS = /\b(AI|artificial intelligence|GPU|H100|GB200|hyperscale|machine learning)\b/i;

type Dc = Record<string, unknown>;

function loadCandidates(): { index: number; dc: Dc; enrichment: Record<string, unknown> }[] {
  const dcs = JSON.parse(fs.readFileSync("./public/data/datacenters.json", "utf-8")) as Dc[];
  const enr = JSON.parse(fs.readFileSync("./public/data/enrichments-compact.json", "utf-8")) as Record<string, Record<string, unknown>>;

  const candidates: { index: number; dc: Dc; enrichment: Record<string, unknown> }[] = [];
  dcs.forEach((dc, i) => {
    const e = enr[String(i)] || {};
    const text = [dc.name, dc.operator, dc.owner, e.notable_tenants, e.description, e.recent_news].join(" ");
    const power = Math.max((dc.powerMw as number) || 0, (e.power_capacity_mw as number) || 0);
    if (AI_SIGNALS.test(text) || power >= 100 || AI_OPERATORS.test(`${dc.operator} ${dc.owner}`)) {
      candidates.push({ index: i, dc, enrichment: e });
    }
  });
  return candidates;
}

function buildInput(dc: Dc, e: Record<string, unknown>): string {
  const facts = [
    `Facility: ${dc.name}`,
    `Operator: ${dc.operator}`,
    dc.owner && dc.owner !== dc.operator ? `Owner: ${dc.owner}` : "",
    `Location: ${dc.address}, ${dc.city}, ${dc.state}`,
    (dc.powerMw as number) > 0 ? `Power: ${dc.powerMw} MW` : "",
    e.notable_tenants ? `Known tenants: ${e.notable_tenants}` : "",
    e.cooling_type ? `Cooling: ${e.cooling_type}` : "",
    e.utility_provider ? `Utility: ${e.utility_provider}` : "",
    e.description ? `Background: ${e.description}` : "",
  ].filter(Boolean).join("\n");

  return `Classify this U.S. data center facility for an infrastructure-investor audience:

${facts}

1. Determine whether this is an AI data center: does it host AI training clusters (GPU superclusters), AI inference/cloud AI workloads, or is it traditional colocation/enterprise? Look for GPU deployments, AI tenant announcements, liquid cooling retrofits, and power density signals.
2. Assess its local-impact profile with specific evidence:
   - WATER: cooling water consumption, water source stress, aquifer/drought concerns, discharge issues.
   - GRID: strain on the local grid, ratepayer cost impact, new generation/transmission required, curtailment risk.
   - COMMUNITY: organized opposition, lawsuits, zoning fights, noise/air-quality complaints (e.g., diesel or gas turbine generators), moratorium campaigns.
Base every classification on verifiable reporting. If there is no evidence for an impact, say so rather than speculating.`;
}

const SCHEMA = {
  type: "json" as const,
  json_schema: {
    type: "object" as const,
    properties: {
      ai_class: {
        type: "string" as const,
        enum: ["ai-training", "ai-inference", "ai-mixed", "cloud-hyperscale", "not-ai"],
        description: "AI workload classification. 'ai-training' = GPU training clusters; 'ai-inference' = inference/cloud AI serving; 'ai-mixed' = both or AI plus other workloads; 'cloud-hyperscale' = hyperscale cloud without confirmed AI focus; 'not-ai' = traditional colo/enterprise.",
      },
      ai_evidence: { type: "string" as const, description: "1-2 sentence evidence for the AI classification (GPU deployments, tenants, announcements). Empty if not-ai." },
      water_impact: { type: "string" as const, enum: ["high", "moderate", "low", "unknown"], description: "Water impact: consumption scale, source stress, discharge concerns." },
      water_note: { type: "string" as const, description: "1 sentence on water: gallons/day if reported, source, drought/aquifer concerns. Empty if nothing found." },
      grid_impact: { type: "string" as const, enum: ["high", "moderate", "low", "unknown"], description: "Grid impact: load relative to local grid, new generation/transmission needed, ratepayer effects." },
      grid_note: { type: "string" as const, description: "1 sentence on grid: MW load, utility upgrades, rate cases. Empty if nothing found." },
      community_pushback: { type: "string" as const, enum: ["active-opposition", "some-concern", "none-found"], description: "Community response: organized opposition/litigation, scattered concern, or none found." },
      community_note: { type: "string" as const, description: "1 sentence on community response: who opposes, over what, current status. Empty if none." },
    },
    required: ["ai_class", "ai_evidence", "water_impact", "water_note", "grid_impact", "grid_note", "community_pushback", "community_note"],
    additionalProperties: false,
  },
};

// ─── Kickoff ─────────────────────────────────────────────────────────

async function kickoff() {
  if (fs.existsSync(RUNS_PATH)) {
    const existing = JSON.parse(fs.readFileSync(RUNS_PATH, "utf-8"));
    console.log(`Already kicked off ${existing.runs?.length || 0} runs (${existing.startedAt}). Delete ${RUNS_PATH} to restart.`);
    return;
  }

  const candidates = loadCandidates();
  console.log(`Classifying ${candidates.length} AI-candidate facilities with ${PROCESSOR}...`);

  const runData: { groups: unknown[]; runs: { runId: string; groupId: string; facilityIndex: number; facilityName: string }[]; startedAt: string; processor: string; totalCandidates: number } = {
    groups: [], runs: [], startedAt: new Date().toISOString(), processor: PROCESSOR, totalCandidates: candidates.length,
  };

  const grpRes = await fetch(`${BASE_URL}/v1/tasks/groups`, {
    method: "POST", headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ metadata: { type: "ai-classification", size: String(candidates.length) } }),
  });
  if (!grpRes.ok) { console.error(`Group create failed: ${grpRes.status} ${await grpRes.text()}`); process.exit(1); }
  const grp = await grpRes.json();
  runData.groups.push({ groupId: grp.taskgroup_id, size: candidates.length });
  console.log(`Task group: ${grp.taskgroup_id}`);

  for (let j = 0; j < candidates.length; j += 500) {
    const sub = candidates.slice(j, j + 500);
    const inputs = sub.map((c) => ({
      input: buildInput(c.dc, c.enrichment),
      task_spec: { output_schema: SCHEMA },
      processor: PROCESSOR,
      metadata: { facility_index: String(c.index), facility_name: String(c.dc.name).slice(0, 100), type: "ai-classification" },
    }));

    const res = await fetch(`${BASE_URL}/v1/tasks/groups/${grp.taskgroup_id}/runs`, {
      method: "POST", headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs }),
    });
    if (!res.ok) { console.error(`  Submit failed at ${j}: ${res.status} ${await res.text()}`); break; }
    const data = await res.json();
    const runIds: string[] = data.run_ids || [];

    runIds.forEach((runId, k) => {
      runData.runs.push({ runId, groupId: grp.taskgroup_id, facilityIndex: sub[k].index, facilityName: String(sub[k].dc.name) });
    });
    // Save immediately after each sub-batch so run IDs are never lost
    fs.writeFileSync(RUNS_PATH, JSON.stringify(runData, null, 2));
    console.log(`  Submitted ${j + 1}-${j + sub.length}: ${runIds.length} run IDs`);
  }

  console.log(`Kicked off ${runData.runs.length} classification tasks. Run 'collect' to gather results.`);
}

// ─── Collect ─────────────────────────────────────────────────────────

async function collect() {
  if (!fs.existsSync(RUNS_PATH)) { console.error("No runs file. Run kickoff first."); process.exit(1); }
  const runData = JSON.parse(fs.readFileSync(RUNS_PATH, "utf-8"));

  let results: Record<string, unknown> = {};
  if (fs.existsSync(OUT_PATH)) results = JSON.parse(fs.readFileSync(OUT_PATH, "utf-8"));

  let collected = 0, pending = 0, failed = 0;

  for (let i = 0; i < runData.runs.length; i += 20) {
    const batch = runData.runs.slice(i, i + 20);
    const settled = await Promise.all(batch.map(async (run: { runId: string; facilityIndex: number; facilityName: string }) => {
      if (results[String(run.facilityIndex)]) return null;

      const statusRes = await fetch(`${BASE_URL}/v1/tasks/runs/${run.runId}`, { headers: { "x-api-key": API_KEY! } });
      if (!statusRes.ok) { pending++; return null; }
      const statusData = await statusRes.json();
      if (statusData.status === "failed") { failed++; return null; }
      if (statusData.status !== "completed") { pending++; return null; }

      const resultRes = await fetch(`${BASE_URL}/v1/tasks/runs/${run.runId}/result`, { headers: { "x-api-key": API_KEY! } });
      if (!resultRes.ok) return null;
      return { run, result: await resultRes.json() };
    }));

    for (const r of settled) {
      if (!r) continue;
      const content = r.result?.output?.content;
      if (!content || typeof content !== "object") continue;
      const basis = (r.result?.output?.basis || []) as { citations?: { title?: string; url?: string }[] }[];
      const citations = basis
        .flatMap((b) => (b.citations || []).map((c) => ({ title: c.title || "", url: c.url || "" })))
        .filter((c) => c.url)
        .slice(0, 5);
      results[String(r.run.facilityIndex)] = { ...content, citations, runId: r.run.runId, classifiedAt: new Date().toISOString() };
      collected++;
    }

    fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 0));
    process.stdout.write(`\r  Collected: ${Object.keys(results).length}/${runData.runs.length} (${collected} new, ${pending} pending, ${failed} failed)`);
    await sleep(100);
  }

  console.log(`\nDone. ${Object.keys(results).length}/${runData.runs.length} classifications in ${OUT_PATH}`);
  if (pending > 0) console.log(`${pending} still pending — re-run 'collect' later.`);
}

// ─── Main ────────────────────────────────────────────────────────────

const mode = process.argv[2];
if (mode === "kickoff") kickoff().catch(console.error);
else if (mode === "collect") collect().catch(console.error);
else { console.error("Usage: npx tsx scripts/classify-ai.ts <kickoff|collect>"); process.exit(1); }
