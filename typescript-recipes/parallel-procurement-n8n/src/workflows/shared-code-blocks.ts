// Shared JS source for n8n Code nodes (finding 20).
//
// Several Code-node bodies appear verbatim across the split workflows
// (WF1, WF2, WF4, WF5) and the combined workflow. Keeping them in one
// place prevents drift like `runIdByDomain` vs `runIdToDomain` between
// WF2 and the combined region. Naming convention: ALL_CAPS_CODE for
// canonical Code-node bodies and ALL_CAPS_JS for inline helpers.

// Vendor-name quote-escaping helper (finding 15). Sourced from
// generator-utils so the TS helper and the interpolated JS string stay
// in lock-step. The dashboard mirrors the same logic in
// lib/parallel/monitor-queries.ts.
import { ESCAPE_VENDOR_NAME_JS } from "./generator-utils.js";

// ── SDK helpers (Sync + Monitor Deploy) ────────────────────────────────

export const SDK_CREATE_MONITOR_CODE = `
const payload = $json.monitorPayload;
if (!payload) {
  throw new Error('Create Monitor: missing monitorPayload on input item.');
}
const monitor = await client.monitor.create(payload);
return [{ json: {
  ...$json,
  monitor_id: monitor.monitor_id,
  monitor,
} }];
`;

export const SDK_CANCEL_MONITOR_CODE = `
const monitorId = $json.monitor_id || $json.id;
if (!monitorId) {
  return [{ json: { ...$json, skipped: true, reason: 'no monitor_id' } }];
}
try {
  const monitor = await client.monitor.cancel(monitorId);
  return [{ json: { ...$json, cancelled: true, status: monitor.status } }];
} catch (err) {
  return [{ json: { ...$json, cancelled: false, error: String(err.message || err) } }];
}
`;

// ── Monitor query templates ────────────────────────────────────────────
//
// Used by the Sync (WF1) Build Monitor Payload node AND the Monitor Deploy
// (WF4) Generate Queries node. We accept an `errorMsg` arg so each caller
// can keep its own error string without duplicating the body.

export function buildMonitorQueryCode(errorMsg: string, webhookPath: string): string {
  return `
${ESCAPE_VENDOR_NAME_JS}
const vendor = $input.first ? $input.first().json : $json;
if (!vendor || !vendor.vendor_name) {
  throw new Error(${JSON.stringify(errorMsg)});
}
const safeName = escapeVendorName(vendor.vendor_name);
const templates = [
  { dim: "legal", cat: "Legal & Regulatory", q: '"' + safeName + '" lawsuit OR litigation OR regulatory action OR SEC investigation OR enforcement' },
  { dim: "cyber", cat: "Cybersecurity", q: '"' + safeName + '" data breach OR cybersecurity incident OR ransomware OR vulnerability disclosure' },
  { dim: "financial", cat: "Financial Health", q: '"' + safeName + '" bankruptcy OR financial distress OR credit downgrade OR debt default OR layoffs' },
  { dim: "leadership", cat: "Leadership & Governance", q: '"' + safeName + '" CEO departure OR executive change OR acquisition OR merger OR leadership' },
  { dim: "esg", cat: "ESG & Reputation", q: '"' + safeName + '" recall OR safety violation OR environmental fine OR labor dispute OR ESG controversy' },
];
const frequency = vendor.monitoring_priority === "low" ? "7d" : "1d";
const selected = vendor.monitoring_priority === "high" ? templates
  : vendor.monitoring_priority === "medium" ? templates.slice(0, 3)
  : [templates[0], templates[2]];

const outputSchema = {
  type: "json",
  json_schema: {
    type: "object",
    properties: {
      event_summary: { type: "string" },
      severity: { type: "string", enum: ["LOW","MEDIUM","HIGH","CRITICAL"] },
      adverse: { type: "boolean" },
      event_type: { type: "string" }
    },
    required: ["event_summary","severity","adverse","event_type"]
  }
};

return selected.map(t => {
  const isHighSignal = vendor.monitoring_priority === "high" && (t.dim === "cyber" || t.dim === "legal");
  return {
    json: {
      vendor_name: vendor.vendor_name,
      vendor_domain: vendor.vendor_domain,
      monitorPayload: {
        type: "event_stream",
        frequency,
        processor: isHighSignal ? "base" : "lite",
        settings: {
          query: t.q,
          output_schema: outputSchema,
          include_backfill: false,
          advanced_settings: { location: "us" }
        },
        webhook: {
          url: ($vars.N8N_WEBHOOK_BASE_URL || "") + ${JSON.stringify(webhookPath)},
          event_types: ["monitor.event.detected"]
        },
        metadata: {
          vendor_name: vendor.vendor_name,
          vendor_domain: vendor.vendor_domain,
          monitor_category: t.cat,
          risk_dimension: t.dim
        }
      }
    }
  };
});
`;
}

// ── Research filter (WF2 / wf-combined region 2) ───────────────────────

export const RESEARCH_FILTER_CODE = `
const today = new Date().toISOString().slice(0, 10);
const vendors = $input.all().map(i => i.json);
const due = vendors.filter(v => {
  if (v.active === false || v.active === "false") return false;
  if (!v.next_research_date) return true;
  return v.next_research_date.slice(0, 10) <= today;
});
return due.map(v => ({ json: v }));
`;

// ── Research run group (finding 18) ────────────────────────────────────
//
// Canonical name is `runIdByDomain` (matches the BatchPlanner TS type).
// At 1h timeout we now emit an audit-log row + a Slack-ready sibling
// indicating how many vendors are still in flight so operators don't
// silently re-cycle them. The terminal status check classifies "in
// flight" as anything other than completed/failed/cancelled.

export const RESEARCH_RUN_GROUP_CODE = `
const vendors = $input.all().map(i => i.json);
if (vendors.length === 0) {
  return [{ json: { vendors: [], runs: [] } }];
}

const outputSchema = {
  type: "json",
  json_schema: {
    type: "object",
    properties: {
      vendor_name: { type: "string" },
      overall_risk_level: { type: "string", enum: ["LOW","MEDIUM","HIGH","CRITICAL"] },
      financial_health: { type: "object", properties: { status: { type: "string" }, findings: { type: "string" }, severity: { type: "string" } }, required: ["status","findings","severity"] },
      legal_regulatory: { type: "object", properties: { status: { type: "string" }, findings: { type: "string" }, severity: { type: "string" } }, required: ["status","findings","severity"] },
      cybersecurity: { type: "object", properties: { status: { type: "string" }, findings: { type: "string" }, severity: { type: "string" } }, required: ["status","findings","severity"] },
      leadership_governance: { type: "object", properties: { status: { type: "string" }, findings: { type: "string" }, severity: { type: "string" } }, required: ["status","findings","severity"] },
      esg_reputation: { type: "object", properties: { status: { type: "string" }, findings: { type: "string" }, severity: { type: "string" } }, required: ["status","findings","severity"] },
      adverse_events: { type: "array", items: { type: "object" } },
      recommendation: { type: "string" },
    },
    required: ["vendor_name","overall_risk_level","financial_health","legal_regulatory","cybersecurity","leadership_governance","esg_reputation","adverse_events","recommendation"]
  }
};

const group = await client.taskGroup.create({});
const taskgroupId = group.taskgroup_id;
const processor = $vars.RESEARCH_PROCESSOR || 'ultra8x';

// Batch in groups of 50 (matches the PRD limit and the TS BatchPlanner).
const BATCH = 50;
const runIdByDomain = new Map();
const orderedDomains = [];
for (let i = 0; i < vendors.length; i += BATCH) {
  const chunk = vendors.slice(i, i + BATCH);
  const inputs = chunk.map(v => ({
    input: 'Conduct a vendor risk assessment of ' + v.vendor_name + ' (' + v.vendor_domain + ').',
    processor,
  }));
  const resp = await client.taskGroup.addRuns(taskgroupId, {
    inputs,
    default_task_spec: { output_schema: outputSchema },
  });
  resp.run_ids.forEach((runId, idx) => {
    const dom = chunk[idx].vendor_domain;
    runIdByDomain.set(runId, dom);
    orderedDomains.push(dom);
  });
}

// Poll the group until is_active=false. Hold a soft 1h ceiling matching
// the TS pollTaskGroupUntilComplete default.
const startedAt = Date.now();
const TIMEOUT_MS = 60 * 60 * 1000;
let timedOut = false;
while (Date.now() - startedAt < TIMEOUT_MS) {
  const status = await client.taskGroup.retrieve(taskgroupId);
  if (!status.status.is_active) { timedOut = false; break; }
  await new Promise(r => setTimeout(r, 60000));
  timedOut = true;
}

// Drain completed runs (and basis) via the streaming getRuns API.
const runs = [];
const stream = await client.taskGroup.getRuns(taskgroupId, { include_output: true });
for await (const event of stream) {
  if (event && event.type === 'task_run.state' && event.run) {
    runs.push({
      run_id: event.run.run_id,
      status: event.run.status,
      output: event.output || null,
    });
  }
}

// Finding 18: log how many vendors are still in flight after the 1h cap
// so operators don't silently re-cycle the same vendors every day.
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const inFlight = runs.filter(r => !TERMINAL.has(r.status)).length;
const opsReport = {
  taskgroup_id: taskgroupId,
  total_vendors: vendors.length,
  total_runs: runs.length,
  in_flight_count: inFlight,
  timed_out: !!timedOut && inFlight > 0,
};

return [{ json: { vendors, runs, runIdByDomain: Array.from(runIdByDomain.entries()), orderedDomains, taskgroup_id: taskgroupId, ops_report: opsReport } }];
`;

// ── Research parse results (canonical name: runIdByDomain) ─────────────

export const RESEARCH_PARSE_RESULTS_CODE = `
const data = $input.first().json;
const vendors = data.vendors || [];
const runs = data.runs || [];
const runIdToDomain = new Map(data.runIdByDomain || []);
const byDomain = new Map(vendors.map(v => [v.vendor_domain, v]));

return runs
  .filter(r => r.status === 'completed' && r.output)
  .map(r => {
    const domain = runIdToDomain.get(r.run_id);
    const vendor = byDomain.get(domain) || {};
    return {
      json: {
        vendor,
        research_output: r.output.content || r.output,
        basis: r.output.basis || [],
        run_id: r.run_id,
        status: r.status,
        source: 'deep_research',
      }
    };
  });
`;

// ── Monitor event subgraph (WF4 + wf-combined region 4) ────────────────

export const MONITOR_PARSE_WEBHOOK_CODE = `
const payload = $input.first().json;
return [{ json: {
  monitor_id: payload.data.monitor_id,
  event_group_id: payload.data.event.event_group_id,
  metadata: payload.data.metadata || {},
} }];
`;

export const MONITOR_FETCH_EVENT_CODE = `
const monitorId = $json.monitor_id;
const eventGroupId = $json.event_group_id;
if (!monitorId || !eventGroupId) {
  throw new Error('Fetch Event Details: missing monitor_id or event_group_id.');
}
const page = await client.monitor.events(monitorId, { event_group_id: eventGroupId });
return [{ json: { ...$json, events: page.events || [] } }];
`;
