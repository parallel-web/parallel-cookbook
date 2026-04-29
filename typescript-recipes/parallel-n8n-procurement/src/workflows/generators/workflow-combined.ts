import {
  resetNodeCounter, pos, scheduleNode, manualTriggerNode,
  googleSheetsNode, codeNode, httpRequestNode, splitInBatchesNode,
  waitNode, ifNode, switchNode, slackNode, webhookNode,
  connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";

// ── Combined Workflow Generator ─────────────────────────────────────────────
// Merges all 5 workflows into a single importable n8n workflow.
// Eliminates all executeWorkflow / executeWorkflowTrigger nodes.
// WF3 (Risk Scoring) is shared via fan-in from Research, Monitor Events,
// and Ad-Hoc flows. A "Route Back" switch after the Audit Log directs
// data to the correct per-flow continuation using the `source` field.

export function generateCombinedWorkflow(): N8nWorkflow {
  resetNodeCounter();

  const nodes = [
    // ── REGION 1: SYNC (WF1) ────────────────────────────────────────────
    scheduleNode("Sync: Daily Midnight Trigger", 0, pos(0, -3)),
    manualTriggerNode("Sync: Manual Trigger", pos(0, -2)),
    googleSheetsNode("Sync: Read Vendor List", "read", "Vendors", pos(1, -3)),
    googleSheetsNode("Sync: Read Previous Registry", "read", "Registry", pos(2, -3)),
    codeNode("Sync: Compute Diff", SYNC_DIFF_CODE, pos(3, -3)),
    splitInBatchesNode("Sync: Loop Added Vendors", 1, pos(4, -4)),
    codeNode("Sync: Build Monitor Payload", SYNC_MONITOR_PAYLOAD_CODE, pos(5, -4)),
    httpRequestNode(
      "Sync: Create Monitor",
      "POST",
      "https://api.parallel.ai/v1alpha/monitors",
      pos(6, -4),
      `={{
        JSON.stringify({
          query: $json.monitorPayload?.query || ('"' + ($json.vendor_name || 'Unknown Vendor') + '" vendor risk'),
          cadence: $json.monitorPayload?.cadence || 'daily',
          webhook: {
            url: ($vars.N8N_WEBHOOK_BASE_URL || '') + '/webhook/parallel-monitor-event',
            event_types: ['monitor.event.detected'],
          },
          metadata: $json.monitorPayload?.metadata || {
            vendor_name: $json.vendor_name || 'Unknown Vendor',
            vendor_domain: $json.vendor_domain || '',
            monitor_category: 'General',
            risk_dimension: 'general',
          },
        })
      }}`,
    ),
    splitInBatchesNode("Sync: Loop Removed Vendors", 1, pos(4, -2)),
    httpRequestNode(
      "Sync: Delete Monitor",
      "DELETE",
      "={{ 'https://api.parallel.ai/v1alpha/monitors/' + ($json.monitor_id || $json.id || '') }}",
      pos(5, -2),
    ),
    googleSheetsNode("Sync: Update Registry", "update", "Registry", pos(7, -3)),

    // ── REGION 2: RESEARCH (WF2 — uses Parallel async enrichment per vendor) ─
    scheduleNode("Research: Daily 6AM Trigger", 6, pos(0, 0)),
    manualTriggerNode("Research: Manual Trigger", pos(0, 1)),
    googleSheetsNode("Research: Read Registry", "read", "Registry", pos(1, 0)),
    codeNode("Research: Filter Due Vendors", RESEARCH_FILTER_CODE, pos(2, 0)),
    codeNode("Research: Build Prompts", RESEARCH_BUILD_PROMPTS_CODE, pos(3, 0)),
    splitInBatchesNode("Research: Loop Vendors", 1, pos(4, 0)),
    httpRequestNode(
      "Research: Run Deep Research",
      "POST",
      "https://api.parallel.ai/v1/tasks/runs",
      pos(5, 0),
      `={{
        JSON.stringify({
          input: $json.prompt || ('Conduct a vendor risk assessment of ' + ($json.vendor_name || 'Unknown Vendor')),
          processor: 'ultra8x',
          task_spec: { output_schema: JSON.parse($json.outputSchema || '{}') },
        })
      }}`,
    ),
    waitNode("Research: Wait 90s", 90, pos(6, 0)),
    codeNode("Research: Collect Results", RESEARCH_COLLECT_CODE, pos(7, 0)),

    // ── REGION 3: MONITOR DEPLOY (WF4 deploy sub-flow) ──────────────────
    webhookNode("Monitor: Deploy Webhook", "/webhook/deploy-monitors", pos(0, 3)),
    codeNode("Monitor: Generate Queries", MONITOR_QUERY_GEN_CODE, pos(1, 3)),
    splitInBatchesNode("Monitor: Loop Monitors", 1, pos(2, 3)),
    httpRequestNode(
      "Monitor: Create Monitor",
      "POST",
      "https://api.parallel.ai/v1alpha/monitors",
      pos(3, 3),
      `={{
        JSON.stringify({
          query: $json.monitorPayload?.query || ('"' + ($json.vendor_name || 'Unknown Vendor') + '" vendor risk'),
          cadence: $json.monitorPayload?.cadence || 'daily',
          webhook: {
            url: ($vars.N8N_WEBHOOK_BASE_URL || '') + '/webhook/parallel-monitor-event',
            event_types: ['monitor.event.detected'],
          },
          metadata: $json.monitorPayload?.metadata || {
            vendor_name: $json.vendor_name || 'Unknown Vendor',
            vendor_domain: $json.vendor_domain || '',
            monitor_category: 'General',
            risk_dimension: 'general',
          },
          output_schema: $json.monitorPayload?.output_schema || {
            type: 'json',
            json_schema: {
              type: 'object',
              properties: {
                event_summary: { type: 'string' },
                severity: { type: 'string' },
                adverse: { type: 'boolean' },
                event_type: { type: 'string' },
              },
              required: ['event_summary', 'severity', 'adverse', 'event_type'],
            },
          },
        })
      }}`,
    ),
    googleSheetsNode("Monitor: Record Monitor IDs", "append", "Monitors", pos(4, 3)),

    // ── REGION 4: MONITOR EVENTS (WF4 event sub-flow) ───────────────────
    webhookNode("Monitor: Event Trigger", "/webhook/parallel-monitor-event", pos(0, 5)),
    codeNode("Monitor: Enrich & Classify Event", MONITOR_ENRICH_NATIVE_CODE, pos(1, 5)),

    // ── REGION 5: AD-HOC (WF5 both sub-flows) ──────────────────────────
    webhookNode("AdHoc: Slack Command", "/webhook/slack-command", pos(0, 7)),
    codeNode("AdHoc: Parse Command", ADHOC_PARSE_CMD_CODE, pos(1, 7)),
    slackNode("AdHoc: Send Acknowledgment", "={{ $json.channel_id }}", pos(2, 7),
      '={{ "\\ud83d\\udd0d Starting deep research on *" + $json.vendor_name + "*. This typically takes 15-30 minutes..." }}'),
    httpRequestNode(
      "AdHoc: Start Research Task",
      "POST",
      "https://api.parallel.ai/v1/tasks/runs",
      pos(3, 7),
      `={{
        JSON.stringify({
          input: $json.prompt || ('Conduct a vendor risk assessment of ' + ($json.vendor_name || 'Unknown Vendor')),
          processor: 'ultra8x',
          task_spec: { output_schema: JSON.parse($json.outputSchema || '{}') },
          webhook: {
            url: $json.webhookUrl || (($vars.N8N_WEBHOOK_BASE_URL || '') + '/webhook/parallel-task-completion'),
            events: ['task_run.status'],
          },
        })
      }}`,
      "Creates a single deep research run with webhook callback",
    ),
    webhookNode("AdHoc: Result Callback", "/webhook/parallel-task-completion", pos(0, 9)),
    codeNode("AdHoc: Tag Source", ADHOC_TAG_SOURCE_CODE, pos(1, 9)),

    // ── REGION 6: SHARED SCORING CHAIN (WF3 inlined + route back) ──────
    codeNode("Scoring: Risk Scorer", SCORING_CODE, pos(5, 12)),
    switchNode("Scoring: Route by Risk Level", "={{ $json.risk_level }}", ["CRITICAL", "HIGH", "MEDIUM", "LOW"], pos(6, 12)),
    slackNode("Scoring: Alert Critical", "={{ $vars.SLACK_ALERT_TARGET || '#procurement-critical' }}", pos(7, 10),
      '={{ "\\ud83d\\udd34 CRITICAL: " + $json.vendor_name + " — " + $json.summary }}'),
    slackNode("Scoring: Alert High", "={{ $vars.SLACK_ALERT_TARGET || '#procurement-critical' }}", pos(7, 11),
      '={{ "\\ud83d\\udfe0 HIGH: " + $json.vendor_name + " — " + $json.summary }}'),
    codeNode("Scoring: Format Digest", SCORING_DIGEST_CODE, pos(7, 12)),
    codeNode("Scoring: Log Low", 'return [$input.first()];', pos(7, 13)),
    googleSheetsNode("Scoring: Audit Log", "append", "Audit Log", pos(8, 12)),
    switchNode("Scoring: Route Back", "={{ $json.source }}", ["deep_research", "adhoc", "monitor_event"], pos(9, 12)),
    googleSheetsNode("Research: Update Research Dates", "update", "Registry", pos(10, 11)),
    slackNode("AdHoc: Post Thread Reply", "={{ $json.channel_id }}", pos(10, 13),
      '={{ $json.text }}'),

    // ── REGION 7: DASHBOARD SNAPSHOT (frontend data endpoint) ────────────
    {
      id: "snapshot-webhook-1",
      name: "Snapshot: Dashboard Webhook",
      type: "n8n-nodes-base.webhook",
      position: [100, 3300] as [number, number],
      typeVersion: 2,
      parameters: {
        path: "procurement-dashboard-snapshot",
        httpMethod: "GET",
        responseMode: "lastNode",
        options: {},
      },
    },
    googleSheetsNode("Snapshot: Read Registry", "read", "Registry", [340, 3200]),
    googleSheetsNode("Snapshot: Read Audit Log", "read", "Audit Log", [580, 3200]),
    googleSheetsNode("Snapshot: Read Monitors", "read", "Monitors", [820, 3200]),
    codeNode("Snapshot: Build Payload", SNAPSHOT_BUILD_PAYLOAD_CODE, [1060, 3200]),
  ];

  const connections = buildConnections([
    // ── SYNC connections ──────────────────────────────────────────────
    connect("Sync: Daily Midnight Trigger", "Sync: Read Vendor List"),
    connect("Sync: Manual Trigger", "Sync: Read Vendor List"),
    connect("Sync: Read Vendor List", "Sync: Read Previous Registry"),
    connect("Sync: Read Previous Registry", "Sync: Compute Diff"),
    connect("Sync: Compute Diff", "Sync: Loop Added Vendors", 0),
    connect("Sync: Compute Diff", "Sync: Loop Removed Vendors", 0),
    connect("Sync: Loop Added Vendors", "Sync: Build Monitor Payload", 0),
    connect("Sync: Build Monitor Payload", "Sync: Create Monitor"),
    connect("Sync: Create Monitor", "Sync: Loop Added Vendors"),
    connect("Sync: Loop Added Vendors", "Sync: Update Registry", 1),
    connect("Sync: Loop Removed Vendors", "Sync: Delete Monitor", 0),
    connect("Sync: Delete Monitor", "Sync: Loop Removed Vendors"),
    connect("Sync: Loop Removed Vendors", "Sync: Update Registry", 1),

    // ── RESEARCH connections ──────────────────────────────────────────
    connect("Research: Daily 6AM Trigger", "Research: Read Registry"),
    connect("Research: Manual Trigger", "Research: Read Registry"),
    connect("Research: Read Registry", "Research: Filter Due Vendors"),
    connect("Research: Filter Due Vendors", "Research: Build Prompts"),
    connect("Research: Build Prompts", "Research: Loop Vendors"),
    connect("Research: Loop Vendors", "Research: Run Deep Research", 0),
    connect("Research: Run Deep Research", "Research: Wait 90s"),
    connect("Research: Wait 90s", "Research: Loop Vendors"),
    connect("Research: Loop Vendors", "Research: Collect Results", 1),
    connect("Research: Collect Results", "Scoring: Risk Scorer"),          // fan-in #1

    // ── MONITOR DEPLOY connections ────────────────────────────────────
    connect("Monitor: Deploy Webhook", "Monitor: Generate Queries"),
    connect("Monitor: Generate Queries", "Monitor: Loop Monitors"),
    connect("Monitor: Loop Monitors", "Monitor: Create Monitor", 0),
    connect("Monitor: Create Monitor", "Monitor: Loop Monitors"),
    connect("Monitor: Loop Monitors", "Monitor: Record Monitor IDs", 1),

    // ── MONITOR EVENTS connections ────────────────────────────────────
    connect("Monitor: Event Trigger", "Monitor: Enrich & Classify Event"),
    connect("Monitor: Enrich & Classify Event", "Scoring: Risk Scorer"),  // fan-in #2

    // ── AD-HOC COMMAND connections ────────────────────────────────────
    connect("AdHoc: Slack Command", "AdHoc: Parse Command"),
    connect("AdHoc: Parse Command", "AdHoc: Send Acknowledgment"),
    connect("AdHoc: Send Acknowledgment", "AdHoc: Start Research Task"),

    // ── AD-HOC CALLBACK connections ──────────────────────────────────
    connect("AdHoc: Result Callback", "AdHoc: Tag Source"),
    connect("AdHoc: Tag Source", "Scoring: Risk Scorer"),                 // fan-in #3

    // ── SHARED SCORING CHAIN connections ─────────────────────────────
    connect("Scoring: Risk Scorer", "Scoring: Route by Risk Level"),
    connect("Scoring: Route by Risk Level", "Scoring: Alert Critical", 0),
    connect("Scoring: Route by Risk Level", "Scoring: Alert High", 1),
    connect("Scoring: Route by Risk Level", "Scoring: Format Digest", 2),
    connect("Scoring: Route by Risk Level", "Scoring: Log Low", 3),
    connect("Scoring: Alert Critical", "Scoring: Audit Log"),
    connect("Scoring: Alert High", "Scoring: Audit Log"),
    connect("Scoring: Format Digest", "Scoring: Audit Log"),
    connect("Scoring: Log Low", "Scoring: Audit Log"),
    connect("Scoring: Audit Log", "Scoring: Route Back"),
    connect("Scoring: Route Back", "Research: Update Research Dates", 0), // deep_research
    connect("Scoring: Route Back", "AdHoc: Post Thread Reply", 1),       // adhoc
    // output 2 (monitor_event) → terminal, no connection needed

    // ── SNAPSHOT connections ─────────────────────────────────────────────
    connect("Snapshot: Dashboard Webhook", "Snapshot: Read Registry"),
    connect("Snapshot: Read Registry", "Snapshot: Read Audit Log"),
    connect("Snapshot: Read Audit Log", "Snapshot: Read Monitors"),
    connect("Snapshot: Read Monitors", "Snapshot: Build Payload"),
  ]);

  return buildWorkflow(
    "Vendor Risk Monitoring — Combined Workflow",
    nodes,
    connections,
  );
}

// ── Code Constants ──────────────────────────────────────────────────────────
// Each constant is a copy from the individual generators with $() references
// updated to use prefixed node names.

const SYNC_DIFF_CODE = `
const incoming = $('Sync: Read Vendor List').all().map(i => i.json);
const previous = $('Sync: Read Previous Registry').all().map(i => i.json);

const incomingMap = new Map(incoming.map(v => [v.vendor_domain, v]));
const previousMap = new Map(previous.map(v => [v.vendor_domain, v]));

const added = incoming.filter(v => !previousMap.has(v.vendor_domain));
const removed = previous.filter(v => !incomingMap.has(v.vendor_domain));
const modified = incoming.filter(v => {
  const prev = previousMap.get(v.vendor_domain);
  return prev && (prev.monitoring_priority !== v.monitoring_priority || prev.vendor_category !== v.vendor_category);
});

return [{ json: { added, removed, modified, unchanged_count: incoming.length - added.length - modified.length } }];
`;

const SYNC_MONITOR_PAYLOAD_CODE = `
const vendor = $json;
if (!vendor || !vendor.vendor_name) {
  throw new Error('Sync: Build Monitor Payload received empty vendor input. Ensure Vendors sheet has vendor_name.');
}
const templates = [
  { dim: "legal", cat: "Legal & Regulatory", q: \`"\${vendor.vendor_name}" lawsuit OR litigation OR regulatory action\` },
  { dim: "cyber", cat: "Cybersecurity", q: \`"\${vendor.vendor_name}" data breach OR cybersecurity incident\` },
  { dim: "financial", cat: "Financial Health", q: \`"\${vendor.vendor_name}" bankruptcy OR financial distress OR credit downgrade\` },
  { dim: "leadership", cat: "Leadership & Governance", q: \`"\${vendor.vendor_name}" CEO departure OR executive change OR merger\` },
  { dim: "esg", cat: "ESG & Reputation", q: \`"\${vendor.vendor_name}" recall OR safety violation OR environmental fine\` },
];
const cadence = vendor.monitoring_priority === "low" ? "weekly" : "daily";
const dims = vendor.monitoring_priority === "high" ? templates
  : vendor.monitoring_priority === "medium" ? templates.slice(0, 3)
  : [templates[0], templates[2]];

return dims.map(t => ({
  json: {
    monitorPayload: {
      query: t.q, cadence,
      metadata: { vendor_name: vendor.vendor_name, vendor_domain: vendor.vendor_domain, monitor_category: t.cat, risk_dimension: t.dim },
    }
  }
}));
`;

const RESEARCH_FILTER_CODE = `
const today = new Date().toISOString().slice(0, 10);
const vendors = $input.all().map(i => i.json);
const due = vendors.filter(v => {
  if (v.active === false || v.active === "false") return false;
  if (!v.next_research_date) return true;
  return v.next_research_date.slice(0, 10) <= today;
});
return due.map(v => ({ json: v }));
`;

const RESEARCH_BUILD_PROMPTS_CODE = `
const vendors = $input.all().map(i => i.json);
const outputSchema = JSON.stringify({
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
});
return vendors
  .filter(v => v && v.vendor_name)
  .map(v => ({
  json: {
    ...v,
    prompt: "Conduct a vendor risk assessment of " + v.vendor_name + " (" + v.vendor_domain + "). " +
      "Investigate financial health, legal & regulatory, cybersecurity, leadership & governance, ESG & reputation. " +
      "Classify each finding by severity (LOW/MEDIUM/HIGH/CRITICAL) and include source URLs.",
    outputSchema,
  }
}}));
`;

const RESEARCH_COLLECT_CODE = `
const items = $input.all().map(i => i.json);
return items.filter(r => r.run_id && r.status === 'started').map(r => ({
  json: {
    vendor: { vendor_name: r.vendor_name, vendor_domain: r.vendor_domain },
    research_output: r.output || r,
    run_id: r.run_id,
    status: r.status,
  }
}));
`;

const MONITOR_QUERY_GEN_CODE = `
const vendor = $input.first().json;
if (!vendor || !vendor.vendor_name) {
  throw new Error('Monitor: Generate Queries received empty vendor input. Pass vendor_name/vendor_domain in webhook payload.');
}
const templates = [
  { dim: "legal", cat: "Legal & Regulatory", q: '"' + vendor.vendor_name + '" lawsuit OR litigation OR regulatory action OR SEC investigation OR enforcement' },
  { dim: "cyber", cat: "Cybersecurity", q: '"' + vendor.vendor_name + '" data breach OR cybersecurity incident OR ransomware OR vulnerability disclosure' },
  { dim: "financial", cat: "Financial Health", q: '"' + vendor.vendor_name + '" bankruptcy OR financial distress OR credit downgrade OR debt default OR layoffs' },
  { dim: "leadership", cat: "Leadership & Governance", q: '"' + vendor.vendor_name + '" CEO departure OR executive change OR acquisition OR merger OR leadership' },
  { dim: "esg", cat: "ESG & Reputation", q: '"' + vendor.vendor_name + '" recall OR safety violation OR environmental fine OR labor dispute OR ESG controversy' },
];
const cadence = vendor.monitoring_priority === "low" ? "weekly" : "daily";
const selected = vendor.monitoring_priority === "high" ? templates
  : vendor.monitoring_priority === "medium" ? templates.slice(0, 3)
  : [templates[0], templates[2]];

return selected.map(t => ({
  json: {
    monitorPayload: {
      query: t.q, cadence,
      metadata: { vendor_name: vendor.vendor_name, vendor_domain: vendor.vendor_domain, monitor_category: t.cat, risk_dimension: t.dim },
      output_schema: {
        type: "json",
        json_schema: { type: "object", properties: { event_summary: { type: "string" }, severity: { type: "string" }, adverse: { type: "boolean" }, event_type: { type: "string" } }, required: ["event_summary","severity","adverse","event_type"] }
      }
    }
  }
}));
`;

// Native monitor trigger auto-fetches event_group, so enrich is simpler
const MONITOR_ENRICH_NATIVE_CODE = `
const data = $input.first().json;
const topEvents = Array.isArray(data.events) ? data.events : [];
const eventGroup = data.event_group || {};
const groupEvents = Array.isArray(eventGroup.events) ? eventGroup.events : [];
const events = topEvents.length ? topEvents : groupEvents;
const eventEntry = events.find(e => e.type === 'event');
let output = {};
if (eventEntry && eventEntry.output && typeof eventEntry.output === 'object') {
  output = eventEntry.output;
} else if (eventEntry && typeof eventEntry.output === 'string') {
  output = { event_summary: eventEntry.output, severity: 'LOW', adverse: false, event_type: 'unknown' };
} else if (data.output && typeof data.output === 'object') {
  output = data.output;
}
return [{
  json: {
    monitor_id: data.monitor_id || data.monitor?.id || data.metadata?.monitor_id,
    metadata: data.metadata || data.monitor?.metadata || {},
    ...output,
    source: 'monitor_event',
    event_date: eventEntry?.event_date || data.event_date,
    source_urls: eventEntry?.source_urls || data.source_urls,
  }
}];
`;

const ADHOC_PARSE_CMD_CODE = `
const payload = $input.first().json;
const vendor_name = (payload.text || '').trim();
if (!vendor_name) throw new Error('Vendor name is required. Usage: /vendor-research {vendor_name}');

const prompt = 'Conduct a comprehensive vendor risk assessment of "' + vendor_name + '". ' +
  'Investigate financial health, legal & regulatory, cybersecurity, leadership & governance, ESG & reputation. ' +
  'Classify each finding by severity (LOW/MEDIUM/HIGH/CRITICAL) and include source URLs.';

const outputSchema = JSON.stringify({
  type: "object",
  properties: {
    vendor_name: { type: "string" },
    overall_risk_level: { type: "string", enum: ["LOW","MEDIUM","HIGH","CRITICAL"] },
    financial_health: { type: "object", properties: { status: { type: "string" }, findings: { type: "string" }, severity: { type: "string" } } },
    legal_regulatory: { type: "object", properties: { status: { type: "string" }, findings: { type: "string" }, severity: { type: "string" } } },
    cybersecurity: { type: "object", properties: { status: { type: "string" }, findings: { type: "string" }, severity: { type: "string" } } },
    leadership_governance: { type: "object", properties: { status: { type: "string" }, findings: { type: "string" }, severity: { type: "string" } } },
    esg_reputation: { type: "object", properties: { status: { type: "string" }, findings: { type: "string" }, severity: { type: "string" } } },
    adverse_events: { type: "array", items: { type: "object" } },
    recommendation: { type: "string" },
  },
  required: ["vendor_name","overall_risk_level","recommendation"]
});

return [{ json: {
  vendor_name,
  channel_id: payload.channel_id || payload.channel,
  user_name: payload.user_name || payload.user,
  response_url: payload.response_url,
  prompt,
  outputSchema,
  webhookUrl: ($vars?.N8N_WEBHOOK_BASE_URL || '') + "/webhook/parallel-task-completion",
} }];
`;

const ADHOC_TAG_SOURCE_CODE = `
const data = $input.first().json || {};
const events = Array.isArray(data.events) ? data.events : [];
const event = events.find((e) => e?.type === 'event') || events[events.length - 1];
const eventData = event?.data || event || {};
const output = (eventData.output && typeof eventData.output === 'object')
  ? eventData.output
  : (data.output && typeof data.output === 'object' ? data.output : {});

const run_id = data.run_id || eventData.run_id || data.id || eventData.id;
const status = data.status || eventData.status || 'completed';

return [{
  json: {
    ...data,
    run_id,
    status,
    research_output: output,
    ...output,
    source: 'adhoc',
  }
}];
`;

const SCORING_CODE = `
const input = $input.first().json;
const output = input.research_output || input;

// Step 1: Severity aggregation
const dims = ['financial_health','legal_regulatory','cybersecurity','leadership_governance','esg_reputation'];
const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
const categories = [];
const mediumCats = [];

for (const dim of dims) {
  const sev = (output[dim]?.severity || 'LOW').toUpperCase();
  counts[sev] = (counts[sev] || 0) + 1;
  if (sev === 'CRITICAL' || sev === 'HIGH') categories.push(dim);
  if (sev === 'MEDIUM') mediumCats.push(dim);
}

// Step 2: Risk level assignment
let risk_level, adverse_flag;
if (counts.CRITICAL > 0) { risk_level = 'CRITICAL'; adverse_flag = true; }
else if (counts.HIGH >= 1) { risk_level = 'HIGH'; adverse_flag = true; }
else if (counts.MEDIUM >= 3) { risk_level = 'MEDIUM'; adverse_flag = new Set(mediumCats).size >= 2; }
else if (counts.MEDIUM >= 1) { risk_level = 'MEDIUM'; adverse_flag = false; }
else { risk_level = 'LOW'; adverse_flag = false; }

// Step 3: Overrides
const overrides = [];
if ((output.cybersecurity?.status || '').toUpperCase() === 'CRITICAL') {
  risk_level = 'CRITICAL'; adverse_flag = true; overrides.push('active_data_breach');
}
if ((output.legal_regulatory?.status || '').toUpperCase() === 'CRITICAL') {
  if (['LOW','MEDIUM'].includes(risk_level)) risk_level = 'HIGH';
  adverse_flag = true; overrides.push('active_government_litigation');
}

// Step 4: Derived fields
const action_required = risk_level === 'HIGH' || risk_level === 'CRITICAL';
const recMap = { LOW: 'continue_monitoring', MEDIUM: 'escalate_review', HIGH: 'initiate_contingency', CRITICAL: 'suspend_relationship' };
const recommendation = recMap[risk_level];
const vendor_name = output.vendor_name || input.vendor?.vendor_name || 'Unknown';
const summary = vendor_name + ' assessed at ' + risk_level + ' risk. ' + (adverse_flag ? 'Adverse conditions detected.' : 'No adverse conditions.');

return [{
  json: {
    vendor_name, risk_level, adverse_flag, action_required, recommendation,
    summary, categories, severity_counts: counts, triggered_overrides: overrides,
    assessment_date: new Date().toISOString().slice(0, 10),
    source: input.source || 'deep_research',
  }
}];
`;

const SCORING_DIGEST_CODE = `
const data = $input.first().json;
return [{ json: { ...data, digest_formatted: true } }];
`;

const SNAPSHOT_BUILD_PAYLOAD_CODE = `
const registry = $('Snapshot: Read Registry').all().map(i => i.json);
const audit_log = $('Snapshot: Read Audit Log').all().map(i => i.json);
const monitors = $('Snapshot: Read Monitors').all().map(i => i.json);

return [{
  json: {
    last_updated: new Date().toISOString(),
    registry,
    audit_log,
    monitors,
    counts: {
      vendors: registry.length,
      audits: audit_log.length,
      monitors: monitors.length,
    },
  }
}];
`;
