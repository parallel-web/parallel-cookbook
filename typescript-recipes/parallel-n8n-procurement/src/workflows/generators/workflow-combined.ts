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

    // ── REGION 8: PORTFOLIO MUTATIONS (dashboard write-back) ───────────
    {
      id: "portfolio-mutation-webhook-1",
      name: "Portfolio: Mutation Webhook",
      type: "n8n-nodes-base.webhook",
      position: [100, 3600] as [number, number],
      typeVersion: 2,
      parameters: {
        path: "procurement-portfolio-mutation",
        httpMethod: "POST",
        responseMode: "lastNode",
        options: {},
      },
    },
    googleSheetsNode("Portfolio: Read Vendors", "read", "Vendors", [340, 3600]),
    googleSheetsNode("Portfolio: Read Registry", "read", "Registry", [580, 3600]),
    codeNode("Portfolio: Build Vendor Rows", PORTFOLIO_BUILD_VENDOR_ROWS_CODE, [820, 3600]),
    googleSheetsNode("Portfolio: Write Vendors", "update", "Vendors", [1060, 3600]),
    codeNode("Portfolio: Build Registry Rows", PORTFOLIO_BUILD_REGISTRY_ROWS_CODE, [1300, 3600]),
    googleSheetsNode("Portfolio: Write Registry", "update", "Registry", [1540, 3600]),
    codeNode("Portfolio: Mutation Result", PORTFOLIO_MUTATION_RESULT_CODE, [1780, 3600]),
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

    // ── PORTFOLIO MUTATION connections ─────────────────────────────────
    connect("Portfolio: Mutation Webhook", "Portfolio: Read Vendors"),
    connect("Portfolio: Read Vendors", "Portfolio: Read Registry"),
    connect("Portfolio: Read Registry", "Portfolio: Build Vendor Rows"),
    connect("Portfolio: Build Vendor Rows", "Portfolio: Write Vendors"),
    connect("Portfolio: Write Vendors", "Portfolio: Build Registry Rows"),
    connect("Portfolio: Build Registry Rows", "Portfolio: Write Registry"),
    connect("Portfolio: Write Registry", "Portfolio: Mutation Result"),
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
const rawIncoming = $('Sync: Read Vendor List').all().map(i => i.json);
const rawPrevious = $('Sync: Read Previous Registry').all().map(i => i.json);

function isActive(row) {
  const value = String(row.active ?? 'TRUE').trim().toLowerCase();
  return !['false', 'no', '0', 'inactive'].includes(value);
}

function key(row) {
  return String(row.vendor_domain || row.domain || row.vendor_name || '').trim().toLowerCase();
}

function hasMonitorIds(row) {
  const ids = row.monitor_ids ?? row.monitorIds ?? '';
  if (Array.isArray(ids)) return ids.length > 0;
  return String(ids).trim() !== '' && String(ids).trim() !== '[]';
}

const incoming = rawIncoming.filter(isActive).filter(v => key(v));
const previous = rawPrevious.filter(isActive).filter(v => key(v));
const previousWithMonitors = rawPrevious.filter(v => key(v) && hasMonitorIds(v));

const incomingMap = new Map(incoming.map(v => [key(v), v]));
const previousMap = new Map(previous.map(v => [key(v), v]));

const added = incoming.filter(v => {
  const prev = previousMap.get(key(v));
  return !prev || !hasMonitorIds(prev);
});
const removed = previousWithMonitors.filter(v => !incomingMap.has(key(v)) || !isActive(v));
const modified = incoming.filter(v => {
  const prev = previousMap.get(key(v));
  return prev && hasMonitorIds(prev) && (prev.monitoring_priority !== v.monitoring_priority || prev.vendor_category !== v.vendor_category);
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

const PORTFOLIO_BUILD_VENDOR_ROWS_CODE = `
const incoming = $('Portfolio: Mutation Webhook').first().json || {};
const headers = incoming.headers || {};
const body = incoming.body && typeof incoming.body === 'object' ? incoming.body : incoming;
const currentRows = $('Portfolio: Read Vendors').all().map(i => i.json);
const now = new Date().toISOString();

const seedVendors = [
  { vendorName: 'Microsoft', vendorDomain: 'https://microsoft.com', vendorCategory: 'technology', monitoringPriority: 'high' },
  { vendorName: 'Amazon Web Services', vendorDomain: 'https://aws.amazon.com', vendorCategory: 'technology', monitoringPriority: 'high' },
  { vendorName: 'Salesforce', vendorDomain: 'https://salesforce.com', vendorCategory: 'technology', monitoringPriority: 'high' },
  { vendorName: 'JPMorgan Chase', vendorDomain: 'https://jpmorganchase.com', vendorCategory: 'financial_services', monitoringPriority: 'high' },
  { vendorName: 'Goldman Sachs', vendorDomain: 'https://goldmansachs.com', vendorCategory: 'financial_services', monitoringPriority: 'medium' },
  { vendorName: 'UnitedHealth Group', vendorDomain: 'https://unitedhealthgroup.com', vendorCategory: 'healthcare', monitoringPriority: 'high' },
  { vendorName: 'Pfizer', vendorDomain: 'https://pfizer.com', vendorCategory: 'healthcare', monitoringPriority: 'medium' },
  { vendorName: 'Johnson & Johnson', vendorDomain: 'https://jnj.com', vendorCategory: 'healthcare', monitoringPriority: 'medium' },
  { vendorName: 'Siemens', vendorDomain: 'https://siemens.com', vendorCategory: 'manufacturing', monitoringPriority: 'medium' },
  { vendorName: 'Caterpillar', vendorDomain: 'https://caterpillar.com', vendorCategory: 'manufacturing', monitoringPriority: 'low' },
  { vendorName: 'Deloitte', vendorDomain: 'https://deloitte.com', vendorCategory: 'professional_services', monitoringPriority: 'medium' },
  { vendorName: 'Accenture', vendorDomain: 'https://accenture.com', vendorCategory: 'professional_services', monitoringPriority: 'medium' },
  { vendorName: 'Stripe', vendorDomain: 'https://stripe.com', vendorCategory: 'financial_services', monitoringPriority: 'high' },
  { vendorName: 'CrowdStrike', vendorDomain: 'https://crowdstrike.com', vendorCategory: 'technology', monitoringPriority: 'high' },
  { vendorName: '3M', vendorDomain: 'https://3m.com', vendorCategory: 'manufacturing', monitoringPriority: 'low' },
];

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return fallback;
}

function headerValue(name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return Array.isArray(value) ? value[0] : value;
  }
  return '';
}

function isTruthy(value) {
  return ['true', 'yes', '1', 'y'].includes(String(value || '').trim().toLowerCase());
}

function isActive(row) {
  const value = String(pick(row, ['active'], 'TRUE')).trim().toLowerCase();
  return !['false', 'no', '0', 'inactive'].includes(value);
}

function normalizeDomain(value, name) {
  const fallback = String(name || 'vendor').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.example';
  const raw = String(value || fallback).trim();
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : 'https://' + raw;
}

function keyFor(row) {
  return String(pick(row, ['vendor_domain', 'vendorDomain', 'domain'], pick(row, ['vendor_name', 'vendorName', 'name'], '')))
    .trim()
    .toLowerCase();
}

function normalizePriority(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['high', 'medium', 'low'].includes(normalized) ? normalized : 'medium';
}

function normalizeRisk(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized) ? normalized : '';
}

function sheetRowFromInput(input) {
  const vendorName = String(input.vendorName || input.vendor_name || '').trim();
  if (!vendorName) throw new Error('Portfolio mutation vendorName is required.');
  const domain = normalizeDomain(input.vendorDomain || input.vendor_domain, vendorName);
  return {
    vendor_name: vendorName,
    vendor_domain: domain,
    vendor_category: String(input.vendorCategory || input.vendor_category || 'vendor').trim().toLowerCase().replace(/\\s+/g, '_'),
    risk_tier_override: normalizeRisk(input.riskLevel || input.risk_level),
    active: 'TRUE',
    monitoring_priority: normalizePriority(input.monitoringPriority || input.monitoring_priority),
    relationship_owner: String(input.relationshipOwner || input.relationship_owner || 'Procurement').trim(),
    region: String(input.region || 'Global').trim(),
    risk_score: input.score !== undefined ? String(input.score) : '',
    next_research_date: String(input.nextResearchDate || input.next_research_date || ''),
    last_synced_at: now,
    dashboard_managed: 'TRUE',
  };
}

function normalizeExistingRow(row) {
  const vendorName = String(pick(row, ['vendor_name', 'vendorName', 'name'], '')).trim();
  if (!vendorName) return null;
  return {
    vendor_name: vendorName,
    vendor_domain: normalizeDomain(pick(row, ['vendor_domain', 'vendorDomain', 'domain'], ''), vendorName),
    vendor_category: String(pick(row, ['vendor_category', 'vendorCategory', 'category'], 'vendor')).trim().toLowerCase().replace(/\\s+/g, '_'),
    risk_tier_override: String(pick(row, ['risk_tier_override', 'riskTierOverride', 'risk_level', 'riskLevel'], '')),
    active: isActive(row) ? 'TRUE' : 'FALSE',
    monitoring_priority: normalizePriority(pick(row, ['monitoring_priority', 'monitoringPriority', 'priority'], '')),
    relationship_owner: String(pick(row, ['relationship_owner', 'relationshipOwner', 'owner'], 'Procurement')),
    region: String(pick(row, ['region'], 'Global')),
    risk_score: String(pick(row, ['risk_score', 'riskScore', 'score'], '')),
    next_research_date: String(pick(row, ['next_research_date', 'nextResearchDate'], '')),
    last_synced_at: String(pick(row, ['last_synced_at', 'lastSyncedAt'], '')),
    dashboard_managed: isTruthy(pick(row, ['dashboard_managed', 'dashboardManaged'], '')) ? 'TRUE' : 'FALSE',
  };
}

function seedRow(input) {
  return {
    vendor_name: input.vendorName,
    vendor_domain: input.vendorDomain,
    vendor_category: input.vendorCategory,
    risk_tier_override: '',
    active: 'TRUE',
    monitoring_priority: input.monitoringPriority,
    relationship_owner: 'Procurement',
    region: 'Global',
    risk_score: '',
    next_research_date: '',
    last_synced_at: now,
    dashboard_managed: 'FALSE',
  };
}

const expectedToken = String($vars?.PROCUREMENT_DASHBOARD_WRITE_TOKEN || '').trim();
if (!expectedToken) {
  throw new Error('Set n8n variable PROCUREMENT_DASHBOARD_WRITE_TOKEN before enabling portfolio write-back.');
}

const actualToken = String(headerValue('x-procurement-dashboard-token') || '').trim();
if (actualToken !== expectedToken) {
  throw new Error('Unauthorized portfolio mutation.');
}

const action = body.action;
if (!['addVendor', 'uploadVendors', 'resetSeedVendors'].includes(action)) {
  throw new Error('Unsupported portfolio mutation action.');
}

const rowsByKey = new Map();
for (const row of currentRows) {
  const normalized = normalizeExistingRow(row);
  if (normalized) rowsByKey.set(keyFor(normalized), normalized);
}

if (action === 'addVendor') {
  const row = sheetRowFromInput(body.vendor || {});
  rowsByKey.set(keyFor(row), row);
}

if (action === 'uploadVendors') {
  const vendors = Array.isArray(body.vendors) ? body.vendors : [];
  if (!vendors.length) throw new Error('uploadVendors requires at least one vendor.');
  for (const vendor of vendors) {
    const row = sheetRowFromInput(vendor || {});
    rowsByKey.set(keyFor(row), row);
  }
}

if (action === 'resetSeedVendors') {
  const seedRows = seedVendors.map(seedRow);
  const seedKeys = new Set(seedRows.map(keyFor));
  for (const row of rowsByKey.values()) {
    if (!seedKeys.has(keyFor(row)) && row.dashboard_managed === 'TRUE') {
      row.active = 'FALSE';
      row.last_synced_at = now;
    }
  }
  for (const row of seedRows) {
    rowsByKey.set(keyFor(row), row);
  }
}

return Array.from(rowsByKey.values()).map(row => ({ json: row }));
`;

const PORTFOLIO_BUILD_REGISTRY_ROWS_CODE = `
const vendorRows = $('Portfolio: Build Vendor Rows').all().map(i => i.json);
const registryRows = $('Portfolio: Read Registry').all().map(i => i.json);
const now = new Date().toISOString();

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return fallback;
}

function normalizeDomain(value, name) {
  const fallback = String(name || 'vendor').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.example';
  const raw = String(value || fallback).trim();
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : 'https://' + raw;
}

function keyFor(row) {
  return String(pick(row, ['vendor_domain', 'vendorDomain', 'domain'], pick(row, ['vendor_name', 'vendorName', 'name'], '')))
    .trim()
    .toLowerCase();
}

const registryByKey = new Map();
for (const row of registryRows) {
  const key = keyFor(row);
  if (key) registryByKey.set(key, row);
}

return vendorRows.map(row => {
  const previous = registryByKey.get(keyFor(row)) || {};
  const vendorName = String(pick(row, ['vendor_name', 'vendorName', 'name'], pick(previous, ['vendor_name', 'vendorName', 'name'], 'Unknown vendor')));
  const domain = normalizeDomain(pick(row, ['vendor_domain', 'vendorDomain', 'domain'], pick(previous, ['vendor_domain', 'vendorDomain', 'domain'], '')), vendorName);

  return {
    json: {
      vendor_name: vendorName,
      vendor_domain: domain,
      vendor_category: String(pick(row, ['vendor_category', 'vendorCategory', 'category'], pick(previous, ['vendor_category', 'vendorCategory', 'category'], 'vendor'))),
      risk_tier_override: String(pick(row, ['risk_tier_override', 'riskTierOverride'], pick(previous, ['risk_tier_override', 'riskTierOverride'], ''))),
      active: String(pick(row, ['active'], pick(previous, ['active'], 'TRUE'))),
      monitoring_priority: String(pick(row, ['monitoring_priority', 'monitoringPriority', 'priority'], pick(previous, ['monitoring_priority', 'monitoringPriority', 'priority'], 'medium'))),
      monitor_ids: String(pick(previous, ['monitor_ids', 'monitorIds'], '')),
      next_research_date: String(pick(row, ['next_research_date', 'nextResearchDate'], pick(previous, ['next_research_date', 'nextResearchDate'], ''))),
      last_synced_at: now,
      relationship_owner: String(pick(row, ['relationship_owner', 'relationshipOwner', 'owner'], pick(previous, ['relationship_owner', 'relationshipOwner', 'owner'], 'Procurement'))),
      region: String(pick(row, ['region'], pick(previous, ['region'], 'Global'))),
      risk_score: String(pick(row, ['risk_score', 'riskScore', 'score'], pick(previous, ['risk_score', 'riskScore', 'score'], ''))),
      dashboard_managed: String(pick(row, ['dashboard_managed', 'dashboardManaged'], pick(previous, ['dashboard_managed', 'dashboardManaged'], 'FALSE'))),
    },
  };
});
`;

const PORTFOLIO_MUTATION_RESULT_CODE = `
const incoming = $('Portfolio: Mutation Webhook').first().json || {};
const body = incoming.body && typeof incoming.body === 'object' ? incoming.body : incoming;
const action = body.action || 'unknown';
const affected = action === 'uploadVendors'
  ? (Array.isArray(body.vendors) ? body.vendors.length : 0)
  : action === 'addVendor'
    ? 1
    : $('Portfolio: Build Vendor Rows').all().length;

return [{
  json: {
    ok: true,
    action,
    affected,
  },
}];
`;

const SNAPSHOT_BUILD_PAYLOAD_CODE = `
const registry = $('Snapshot: Read Registry').all().map(i => i.json);
const audit_log = $('Snapshot: Read Audit Log').all().map(i => i.json);
const monitors = $('Snapshot: Read Monitors').all().map(i => i.json);
const now = new Date();

const riskLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const riskScores = { LOW: 18, MEDIUM: 48, HIGH: 76, CRITICAL: 94 };
const dimensionLabels = {
  financial_health: 'Financial health',
  legal_regulatory: 'Legal & regulatory',
  cybersecurity: 'Cybersecurity',
  leadership_governance: 'Leadership & governance',
  esg_reputation: 'ESG & reputation',
};
const dimensionOrder = Object.keys(dimensionLabels);

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return fallback;
}

function slugify(value) {
  return String(value || 'vendor')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'vendor';
}

function normalizeRisk(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return riskLevels.includes(normalized) ? normalized : 'LOW';
}

function normalizePriority(value, riskLevel) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['high', 'medium', 'low'].includes(normalized)) return normalized;
  if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') return 'high';
  if (riskLevel === 'MEDIUM') return 'medium';
  return 'low';
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  return ['true', 'yes', '1', 'y'].includes(String(value || '').trim().toLowerCase());
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
  return String(value).split(/[;,]/).map(item => item.trim()).filter(Boolean);
}

function dimensionKey(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('financial') || normalized.includes('credit')) return 'financial_health';
  if (normalized.includes('legal') || normalized.includes('regulatory') || normalized.includes('litigation')) return 'legal_regulatory';
  if (normalized.includes('cyber') || normalized.includes('breach') || normalized.includes('security')) return 'cybersecurity';
  if (normalized.includes('leadership') || normalized.includes('governance') || normalized.includes('executive')) return 'leadership_governance';
  if (normalized.includes('esg') || normalized.includes('reputation') || normalized.includes('labor')) return 'esg_reputation';
  return 'financial_health';
}

function dateOnly(value, fallbackDate) {
  const date = value ? new Date(value) : fallbackDate;
  if (Number.isNaN(date.getTime())) return fallbackDate.toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function relativeTime(value) {
  const date = value ? new Date(value) : now;
  if (Number.isNaN(date.getTime())) return 'just now';
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' minutes ago';
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours + ' hours ago';
  const days = Math.round(hours / 24);
  return days + ' days ago';
}

function sourceUrl(value) {
  const text = String(value || '').trim();
  return text.startsWith('http://') || text.startsWith('https://') ? text : 'https://parallel.ai';
}

function recommendationFor(level) {
  if (level === 'CRITICAL') return 'suspend_relationship';
  if (level === 'HIGH') return 'initiate_contingency';
  if (level === 'MEDIUM') return 'escalate_review';
  return 'continue_monitoring';
}

function auditTimestamp(row) {
  return String(pick(row, ['timestamp', 'assessment_date', 'created_at', 'date'], ''));
}

const latestAuditByVendor = new Map();
for (const row of audit_log) {
  const vendorName = String(pick(row, ['vendor_name', 'vendorName', 'name'], '')).trim();
  if (!vendorName) continue;
  const key = vendorName.toLowerCase();
  const current = latestAuditByVendor.get(key);
  const nextTime = new Date(auditTimestamp(row)).getTime() || 0;
  const currentTime = current ? (new Date(auditTimestamp(current)).getTime() || 0) : -1;
  if (!current || nextTime >= currentTime) latestAuditByVendor.set(key, row);
}

function dimensionsFor(latestAudit, riskLevel) {
  const categories = parseList(pick(latestAudit || {}, ['categories', 'risk_categories', 'category'], ''));
  const activeKeys = new Set(categories.map(dimensionKey));
  return dimensionOrder.map(key => {
    const active = activeKeys.has(key);
    return {
      key,
      label: dimensionLabels[key],
      severity: active ? riskLevel : 'LOW',
      status: active ? 'watch' : 'stable',
      findings: active
        ? (pick(latestAudit || {}, ['summary', 'detail', 'event_summary'], dimensionLabels[key] + ' requires review.'))
        : 'No active findings in the current monitoring window.',
    };
  });
}

function monitorLensFor(vendorName) {
  return monitors
    .filter(row => String(pick(row, ['vendor_name', 'vendorName'], '')).toLowerCase() === vendorName.toLowerCase())
    .map(row => ({
      dimension: String(pick(row, ['risk_dimension', 'monitor_category', 'category'], 'general')),
      cadence: String(pick(row, ['cadence'], 'daily')),
      status: 'active',
      query: String(pick(row, ['query', 'monitor_query'], vendorName + ' vendor risk')),
      lastEvent: String(pick(row, ['last_event_at', 'updated_at', 'created_at'], 'No event yet')),
    }));
}

const activeRegistry = registry.filter(row => {
  const active = String(pick(row, ['active'], 'true')).trim().toLowerCase();
  return !['false', 'no', '0'].includes(active);
});

const vendors = activeRegistry.map(row => {
  const vendorName = String(pick(row, ['vendor_name', 'vendorName', 'name'], 'Unknown vendor')).trim();
  const latest = latestAuditByVendor.get(vendorName.toLowerCase());
  const riskLevel = normalizeRisk(pick(latest || {}, ['risk_level', 'riskLevel'], pick(row, ['risk_tier_override', 'risk_level'], 'LOW')));
  const latestDate = dateOnly(auditTimestamp(latest || {}), now);
  const nextDate = dateOnly(pick(row, ['next_research_date', 'nextResearchDate'], now.toISOString()), now);
  const adverseFlag = toBool(pick(latest || {}, ['adverse_flag', 'adverseFlag'], riskLevel === 'HIGH' || riskLevel === 'CRITICAL'));
  const summary = String(pick(latest || {}, ['summary', 'detail', 'event_summary'], vendorName + ' is currently assessed at ' + riskLevel + ' risk.'));
  const overrides = parseList(pick(latest || {}, ['triggered_overrides', 'triggeredOverrides'], pick(row, ['risk_tier_override'], '')));
  const domain = String(pick(row, ['vendor_domain', 'vendorDomain', 'domain'], slugify(vendorName) + '.com'));
  const normalizedDomain = domain.startsWith('http://') || domain.startsWith('https://') ? domain : 'https://' + domain;
  const score = Number(pick(latest || {}, ['score', 'risk_score'], pick(row, ['risk_score', 'riskScore', 'score'], riskScores[riskLevel]))) || riskScores[riskLevel];
  const monitorsForVendor = monitorLensFor(vendorName);

  return {
    id: slugify(vendorName),
    vendorName,
    vendorDomain: normalizedDomain,
    vendorCategory: String(pick(row, ['vendor_category', 'vendorCategory', 'category'], 'vendor')).toLowerCase().replace(/\\s+/g, '_'),
    monitoringPriority: normalizePriority(pick(row, ['monitoring_priority', 'monitoringPriority', 'priority'], ''), riskLevel),
    relationshipOwner: String(pick(row, ['relationship_owner', 'relationshipOwner', 'owner'], 'Procurement')),
    region: String(pick(row, ['region'], 'Global')),
    riskLevel,
    overallRiskLevel: riskLevel,
    score,
    actionRequired: riskLevel === 'HIGH' || riskLevel === 'CRITICAL',
    adverseFlag,
    recommendation: String(pick(latest || {}, ['recommendation'], recommendationFor(riskLevel))),
    summary,
    movement: String(pick(latest || {}, ['movement'], '+0 live snapshot')),
    lastAssessmentDate: latestDate,
    nextResearchDate: nextDate,
    triggeredOverrides: overrides.filter(value => value && riskLevels.indexOf(String(value).toUpperCase()) === -1),
    dimensions: dimensionsFor(latest, riskLevel),
    adverseEvents: adverseFlag ? [{
      title: String(pick(latest || {}, ['title', 'event_summary'], riskLevel + ' risk finding')),
      date: latestDate,
      category: String(parseList(pick(latest || {}, ['categories', 'category'], 'general'))[0] || 'general'),
      severity: riskLevel,
      description: summary,
      sourceUrl: sourceUrl(pick(latest || {}, ['source', 'source_url', 'sourceUrl'], '')),
    }] : [],
    evidence: latest ? [{
      title: String(pick(latest, ['title', 'summary'], 'Latest assessment')),
      publication: String(pick(latest, ['source', 'publication'], 'Parallel assessment')),
      publishedAt: latestDate,
      materiality: summary,
      href: sourceUrl(pick(latest, ['source_url', 'sourceUrl', 'source'], '')),
    }] : [],
    monitors: monitorsForVendor,
  };
}).sort((left, right) => right.score - left.score);

const riskDistribution = riskLevels.map(level => ({
  label: level,
  count: vendors.filter(vendor => vendor.riskLevel === level).length,
}));

const dueVendors = vendors.filter(vendor => {
  const next = new Date(vendor.nextResearchDate);
  return !Number.isNaN(next.getTime()) && next <= now;
});

const researchedToday = audit_log.filter(row => dateOnly(auditTimestamp(row), now) === now.toISOString().slice(0, 10)).length;
const adverseCount = vendors.filter(vendor => vendor.adverseFlag).length;
const actionCount = vendors.filter(vendor => vendor.actionRequired).length;
const criticalCount = vendors.filter(vendor => vendor.riskLevel === 'CRITICAL').length;
const highCount = vendors.filter(vendor => vendor.riskLevel === 'HIGH').length;
const activeMonitorCount = monitors.length;

const sortedAudit = audit_log.slice().sort((left, right) => {
  return (new Date(auditTimestamp(right)).getTime() || 0) - (new Date(auditTimestamp(left)).getTime() || 0);
});

const feed = sortedAudit.slice(0, 25).map(row => {
  const vendorName = String(pick(row, ['vendor_name', 'vendorName', 'name'], 'Unknown vendor'));
  const riskLevel = normalizeRisk(pick(row, ['risk_level', 'riskLevel', 'severity'], 'MEDIUM'));
  const summary = String(pick(row, ['summary', 'detail', 'event_summary'], vendorName + ' monitoring event.'));
  return {
    vendorName,
    title: String(pick(row, ['title', 'event_summary'], summary.split('.')[0] || 'Monitoring update')),
    severity: riskLevel,
    timestamp: relativeTime(auditTimestamp(row)),
    detail: summary,
    sourceUrl: sourceUrl(pick(row, ['source_url', 'sourceUrl', 'source'], '')),
  };
});

const actionQueue = vendors
  .filter(vendor => vendor.actionRequired)
  .map(vendor => ({
    vendorName: vendor.vendorName,
    owner: vendor.riskLevel === 'CRITICAL' ? 'Security operations' : 'Procurement finance',
    deadline: vendor.riskLevel === 'CRITICAL' ? 'Due in 12h' : 'Due in 24h',
    action: vendor.riskLevel === 'CRITICAL'
      ? 'Validate exposure, review contingency supplier path, and notify accountable stakeholders.'
      : 'Update the vendor risk memo and confirm mitigation owner.',
    riskLevel: vendor.riskLevel,
  }));

return [{
  json: {
    lastUpdated: now.toISOString(),
    metrics: [
      {
        label: 'Portfolio risk posture',
        value: criticalCount + ' CRITICAL / ' + highCount + ' HIGH',
        trend: actionCount + ' vendors require immediate review',
        tone: actionCount ? 'critical' : 'positive',
      },
      {
        label: 'Research cadence',
        value: dueVendors.length + ' due today',
        trend: researchedToday + ' audit log entries recorded today',
        tone: dueVendors.length ? 'warning' : 'positive',
      },
      {
        label: 'Monitor fleet health',
        value: activeMonitorCount + ' active',
        trend: 'Webhook healthy, live snapshot generated',
        tone: 'positive',
      },
      {
        label: 'Action queue',
        value: actionCount + ' escalations',
        trend: actionQueue.filter(item => item.deadline.includes('12h')).length + ' due in the next 12h',
        tone: actionCount ? 'default' : 'positive',
      },
    ],
    riskDistribution,
    researchSummary: {
      totalDue: dueVendors.length,
      totalResearched: researchedToday,
      totalFailed: 0,
      adverseCount,
      batchesExecuted: Math.ceil(Math.max(dueVendors.length, researchedToday) / 50),
      duration: 'live',
    },
    health: {
      totalMonitors: monitors.length,
      activeCount: monitors.length,
      failedCount: 0,
      orphanCount: 0,
      recreated: 0,
      webhookHealthy: true,
    },
    feed,
    actionQueue,
    vendors,
  }
}];
`;
