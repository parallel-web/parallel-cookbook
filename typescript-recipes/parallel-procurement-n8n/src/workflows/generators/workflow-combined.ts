import {
  resetNodeCounter, pos, scheduleNode, manualTriggerNode,
  googleSheetsNode, codeNode, parallelSdkCodeNode, splitInBatchesNode,
  switchNode, slackNode, webhookNode,
  connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";
import {
  SDK_CREATE_MONITOR_CODE,
  SDK_CANCEL_MONITOR_CODE,
  buildMonitorQueryCode,
  RESEARCH_FILTER_CODE,
  RESEARCH_RUN_GROUP_CODE,
  RESEARCH_PARSE_RESULTS_CODE,
  MONITOR_PARSE_WEBHOOK_CODE,
  MONITOR_FETCH_EVENT_CODE,
} from "../shared-code-blocks.js";
import { SCORING_CODE as WF3_SCORING_CODE } from "./workflow3-risk-scoring.js";

// Code blocks specific to wf-combined (shared across regions 1+3 with
// distinct error strings + monitor-event webhook path).
const SYNC_MONITOR_PAYLOAD_CODE = buildMonitorQueryCode(
  "Sync: Build Monitor Payload received empty vendor input. Ensure Vendors sheet has vendor_name.",
  "/webhook/parallel-monitor-event",
);
const MONITOR_QUERY_GEN_CODE = buildMonitorQueryCode(
  "Monitor: Generate Queries received empty vendor input. Pass vendor_name/vendor_domain in webhook payload.",
  "/webhook/parallel-monitor-event",
);

// Combined workflow — inlines all 5 split-mode workflows into a single
// importable JSON. Every Parallel API call is an SDK call
// (`client.monitor.*`, `client.taskRun.*`, `client.taskGroup.*`). The
// shared scorer is re-used verbatim from workflow3-risk-scoring.ts so
// the n8n inline + TS reference behaviors stay in lock-step. The
// dashboard snapshot region is unchanged.

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
    parallelSdkCodeNode("Sync: Create Monitor", SDK_CREATE_MONITOR_CODE, pos(6, -4)),
    splitInBatchesNode("Sync: Loop Removed Vendors", 1, pos(4, -2)),
    parallelSdkCodeNode("Sync: Cancel Monitor", SDK_CANCEL_MONITOR_CODE, pos(5, -2)),
    // (research region below now uses shared RESEARCH_*_CODE so the combined
    // workflow stays in lock-step with WF2.)
    googleSheetsNode("Sync: Update Registry", "update", "Registry", pos(7, -3)),

    // ── REGION 2: RESEARCH (WF2 — Task Group SDK) ──────────────────────
    scheduleNode("Research: Daily 6AM Trigger", 6, pos(0, 0)),
    manualTriggerNode("Research: Manual Trigger", pos(0, 1)),
    googleSheetsNode("Research: Read Registry", "read", "Registry", pos(1, 0)),
    codeNode("Research: Filter Due Vendors", RESEARCH_FILTER_CODE, pos(2, 0)),
    parallelSdkCodeNode("Research: Run Task Group", RESEARCH_RUN_GROUP_CODE, pos(3, 0)),
    codeNode("Research: Parse Results", RESEARCH_PARSE_RESULTS_CODE, pos(4, 0)),

    // ── REGION 3: MONITOR DEPLOY (WF4 sub-flow A) ──────────────────────
    webhookNode("Monitor: Deploy Webhook", "/webhook/deploy-monitors", pos(0, 3)),
    codeNode("Monitor: Generate Queries", MONITOR_QUERY_GEN_CODE, pos(1, 3)),
    splitInBatchesNode("Monitor: Loop Monitors", 1, pos(2, 3)),
    parallelSdkCodeNode("Monitor: Create Monitor", SDK_CREATE_MONITOR_CODE, pos(3, 3)),
    googleSheetsNode("Monitor: Record Monitor IDs", "append", "Monitors", pos(4, 3)),

    // ── REGION 4: MONITOR EVENTS (WF4 sub-flow B) ──────────────────────
    webhookNode("Monitor: Event Trigger", "/webhook/parallel-monitor-event", pos(0, 5)),
    codeNode("Monitor: Parse Webhook", MONITOR_PARSE_WEBHOOK_CODE, pos(1, 5)),
    parallelSdkCodeNode("Monitor: Fetch Event Details", MONITOR_FETCH_EVENT_CODE, pos(2, 5)),
    codeNode("Monitor: Enrich & Classify Event", COMBINED_MONITOR_ENRICH_CODE, pos(3, 5)),

    // ── REGION 5: AD-HOC (WF5) ─────────────────────────────────────────
    webhookNode("AdHoc: Slack Command", "/webhook/slack-command", pos(0, 7)),
    codeNode("AdHoc: Parse Command", ADHOC_PARSE_CMD_CODE, pos(1, 7)),
    slackNode("AdHoc: Send Acknowledgment", "={{ $json.channel_id }}", pos(2, 7),
      '={{ "\\ud83d\\udd0d Starting deep research on *" + $json.vendor_name + "*. This typically takes 15-30 minutes..." }}'),
    parallelSdkCodeNode("AdHoc: Start Research Task", ADHOC_START_TASK_CODE, pos(3, 7)),
    webhookNode("AdHoc: Result Callback", "/webhook/parallel-task-completion", pos(0, 9)),
    codeNode("AdHoc: Extract Run ID", ADHOC_EXTRACT_RUN_ID_CODE, pos(1, 9)),
    parallelSdkCodeNode("AdHoc: Fetch Result", ADHOC_FETCH_RESULT_CODE, pos(2, 9)),
    codeNode("AdHoc: Tag Source", ADHOC_TAG_SOURCE_CODE, pos(3, 9)),

    // ── REGION 6: SHARED SCORING CHAIN (WF3 inlined + route back) ──────
    codeNode("Scoring: Risk Scorer", WF3_SCORING_CODE, pos(5, 12)),
    switchNode("Scoring: Route by Risk Level", "={{ $json.risk_level }}", ["CRITICAL", "HIGH", "MEDIUM", "LOW"], pos(6, 12)),
    slackNode("Scoring: Alert Critical", "={{ $vars.SLACK_ALERT_TARGET || '@sahithjagarlamudi' }}", pos(7, 10),
      '={{ "\\ud83d\\udd34 CRITICAL: " + $json.vendor_name + " — " + $json.summary + ($json.top_citation_url ? "\\nSource: <" + $json.top_citation_url + "|" + ($json.top_citation_title || $json.top_citation_url) + ">" : "") }}'),
    slackNode("Scoring: Alert High", "={{ $vars.SLACK_ALERT_TARGET || '@sahithjagarlamudi' }}", pos(7, 11),
      '={{ "\\ud83d\\udfe0 HIGH: " + $json.vendor_name + " — " + $json.summary + ($json.top_citation_url ? "\\nSource: <" + $json.top_citation_url + "|" + ($json.top_citation_title || $json.top_citation_url) + ">" : "") }}'),
    codeNode("Scoring: Format Digest", SCORING_DIGEST_CODE, pos(7, 12)),
    codeNode("Scoring: Log Low", 'return [$input.first()];', pos(7, 13)),
    googleSheetsNode("Scoring: Audit Log", "append", "Audit Log", pos(8, 12)),
    switchNode("Scoring: Route Back", "={{ $json.source }}", ["deep_research", "adhoc", "monitor_event"], pos(9, 12)),
    googleSheetsNode("Research: Update Research Dates", "update", "Registry", pos(10, 11)),
    slackNode("AdHoc: Post Thread Reply", "={{ $json.channel_id }}", pos(10, 13),
      '={{ "\\ud83d\\udcca *" + $json.vendor_name + "* assessed at *" + $json.risk_level + "* risk.\\n" + $json.summary + ($json.top_citation_url ? "\\nSource: <" + $json.top_citation_url + "|" + ($json.top_citation_title || $json.top_citation_url) + ">" : "") }}'),

    // ── REGION 7: DASHBOARD SNAPSHOT (frontend data endpoint) ──────────
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
    // Token gate (finding 6) — without this the snapshot endpoint dumps
    // the entire vendor registry, audit log, and monitor list to anyone
    // who knows the URL. Compares a `?t=` query param (or
    // x-procurement-token header) against $vars.PROCUREMENT_SNAPSHOT_TOKEN
    // and throws on mismatch so n8n returns 500. Matches the pattern the
    // dashboard's monitorWebhookUrl() uses for its own webhooks.
    codeNode("Snapshot: Verify Token", SNAPSHOT_VERIFY_TOKEN_CODE, [220, 3300]),
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
    connect("Sync: Loop Removed Vendors", "Sync: Cancel Monitor", 0),
    connect("Sync: Cancel Monitor", "Sync: Loop Removed Vendors"),
    connect("Sync: Loop Removed Vendors", "Sync: Update Registry", 1),

    // ── RESEARCH connections ──────────────────────────────────────────
    connect("Research: Daily 6AM Trigger", "Research: Read Registry"),
    connect("Research: Manual Trigger", "Research: Read Registry"),
    connect("Research: Read Registry", "Research: Filter Due Vendors"),
    connect("Research: Filter Due Vendors", "Research: Run Task Group"),
    connect("Research: Run Task Group", "Research: Parse Results"),
    connect("Research: Parse Results", "Scoring: Risk Scorer"),

    // ── MONITOR DEPLOY connections ────────────────────────────────────
    connect("Monitor: Deploy Webhook", "Monitor: Generate Queries"),
    connect("Monitor: Generate Queries", "Monitor: Loop Monitors"),
    connect("Monitor: Loop Monitors", "Monitor: Create Monitor", 0),
    connect("Monitor: Create Monitor", "Monitor: Loop Monitors"),
    connect("Monitor: Loop Monitors", "Monitor: Record Monitor IDs", 1),

    // ── MONITOR EVENTS connections ────────────────────────────────────
    connect("Monitor: Event Trigger", "Monitor: Parse Webhook"),
    connect("Monitor: Parse Webhook", "Monitor: Fetch Event Details"),
    connect("Monitor: Fetch Event Details", "Monitor: Enrich & Classify Event"),
    connect("Monitor: Enrich & Classify Event", "Scoring: Risk Scorer"),

    // ── AD-HOC COMMAND connections ────────────────────────────────────
    connect("AdHoc: Slack Command", "AdHoc: Parse Command"),
    connect("AdHoc: Parse Command", "AdHoc: Send Acknowledgment"),
    connect("AdHoc: Send Acknowledgment", "AdHoc: Start Research Task"),

    // ── AD-HOC CALLBACK connections ──────────────────────────────────
    connect("AdHoc: Result Callback", "AdHoc: Extract Run ID"),
    connect("AdHoc: Extract Run ID", "AdHoc: Fetch Result"),
    connect("AdHoc: Fetch Result", "AdHoc: Tag Source"),
    connect("AdHoc: Tag Source", "Scoring: Risk Scorer"),

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
    connect("Scoring: Route Back", "Research: Update Research Dates", 0),
    connect("Scoring: Route Back", "AdHoc: Post Thread Reply", 1),
    // output 2 (monitor_event) → terminal, no connection needed

    // ── SNAPSHOT connections ─────────────────────────────────────────
    connect("Snapshot: Dashboard Webhook", "Snapshot: Verify Token"),
    connect("Snapshot: Verify Token", "Snapshot: Read Registry"),
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

// ── Sync (WF1) Code ────────────────────────────────────────────────────
// SDK_CREATE_MONITOR_CODE / SDK_CANCEL_MONITOR_CODE / SYNC_MONITOR_PAYLOAD_CODE
// now imported from shared-code-blocks.ts (finding 20).

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

// ── Research (WF2) Code ────────────────────────────────────────────────
// RESEARCH_FILTER_CODE / RESEARCH_RUN_GROUP_CODE / RESEARCH_PARSE_RESULTS_CODE
// imported from shared-code-blocks.ts. RESEARCH_RUN_GROUP_CODE now also
// emits an ops_report counting in-flight runs after the 1h cap (finding 18).

// ── Monitor Deploy (WF4 sub-flow A) Code ───────────────────────────────
// MONITOR_QUERY_GEN_CODE imported above from shared-code-blocks via
// buildMonitorQueryCode(...).

// ── Monitor Events (WF4 sub-flow B) Code ───────────────────────────────
// MONITOR_PARSE_WEBHOOK_CODE / MONITOR_FETCH_EVENT_CODE imported from
// shared-code-blocks. The combined-region enrich differs slightly from
// WF4's (it builds a `research_output` sub-tree for the inline scorer), so
// it stays here as COMBINED_MONITOR_ENRICH_CODE.

const COMBINED_MONITOR_ENRICH_CODE = `
const data = $input.first().json;
const events = Array.isArray(data.events) ? data.events : [];
const entry = events.find(e => !e.event_type || e.event_type === 'event_stream');

let output = {};
let basis = [];
if (entry && entry.output) {
  basis = Array.isArray(entry.output.basis) ? entry.output.basis : [];
  const content = entry.output.content;
  if (entry.output.type === 'json' && content && typeof content === 'object') {
    output = content;
  } else if (entry.output.type === 'text' && typeof content === 'string') {
    output = { event_summary: content, severity: 'LOW', adverse: false, event_type: 'unknown' };
  }
}

const vendorContext = data.metadata || {};
return [{ json: {
  monitor_id: data.monitor_id,
  event_group_id: data.event_group_id,
  metadata: vendorContext,
  vendor: {
    vendor_name: vendorContext.vendor_name,
    vendor_domain: vendorContext.vendor_domain,
  },
  event_id: entry ? entry.event_id : null,
  event_date: entry ? entry.event_date : null,
  event_summary: output.event_summary || '',
  severity: output.severity || 'LOW',
  adverse: !!output.adverse,
  event_type: output.event_type || vendorContext.risk_dimension || 'unknown',
  basis,
  source: 'monitor_event',
  // Repeat dimension values at the top level so the inline scorer can
  // map them onto the dimensions schema for a single-dimension event.
  research_output: {
    [vendorContext.risk_dimension || 'event']: {
      status: output.severity || 'LOW',
      severity: output.severity || 'LOW',
      findings: output.event_summary || '',
    }
  },
  run_id: entry ? entry.event_id : data.event_group_id,
} }];
`;

// ── Ad-Hoc (WF5) Code ──────────────────────────────────────────────────

const ADHOC_PARSE_CMD_CODE = `
const payload = $input.first().json;
const vendor_name = (payload.text || '').trim();
if (!vendor_name) throw new Error('Vendor name is required. Usage: /vendor-research {vendor_name}');

const prompt = 'Conduct a comprehensive vendor risk assessment of "' + vendor_name + '". ' +
  'Investigate financial health, legal & regulatory, cybersecurity, leadership & governance, ESG & reputation. ' +
  'Classify each finding by severity (LOW/MEDIUM/HIGH/CRITICAL) and include source URLs.';

const outputSchema = {
  type: "json",
  json_schema: {
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
  }
};

return [{ json: {
  vendor_name,
  channel_id: payload.channel_id || payload.channel,
  user_name: payload.user_name || payload.user,
  response_url: payload.response_url,
  prompt,
  outputSchema,
} }];
`;

const ADHOC_START_TASK_CODE = `
const item = $json;
const run = await client.taskRun.create({
  input: item.prompt,
  processor: $vars.RESEARCH_PROCESSOR || 'ultra8x',
  task_spec: { output_schema: item.outputSchema },
  webhook: {
    url: ($vars.N8N_WEBHOOK_BASE_URL || '') + '/webhook/parallel-task-completion',
    event_types: ['task_run.status'],
  },
});
return [{ json: {
  vendor_name: item.vendor_name,
  channel_id: item.channel_id,
  user_name: item.user_name,
  run_id: run.run_id,
  status: run.status,
} }];
`;

// Short-circuit when the run hasn't completed yet — task_run.status webhooks
// fire for queued/running/action_required/cancelling too. Returning [] drops
// the item so the downstream AdHoc: Fetch Result node only runs against a
// terminal-completed run.
const ADHOC_EXTRACT_RUN_ID_CODE = `
const d = $input.first().json;
const run_id = d.run_id || (d.data && d.data.run_id);
const status = d.status || (d.data && d.data.status);
if (status && status !== 'completed') {
  return [];
}
return [{ json: {
  ...d,
  run_id,
  status,
} }];
`;

const ADHOC_FETCH_RESULT_CODE = `
const runId = $json.run_id;
if (!runId) throw new Error('AdHoc: Fetch Result — missing run_id.');
const result = await client.taskRun.result(runId);
return [{ json: {
  ...$json,
  research_output: result.output && result.output.content,
  basis: (result.output && result.output.basis) || [],
} }];
`;

const ADHOC_TAG_SOURCE_CODE = `
const data = $input.first().json || {};
return [{ json: { ...data, source: 'adhoc' } }];
`;

// ── Scoring Helpers ────────────────────────────────────────────────────

const SCORING_DIGEST_CODE = `
const data = $input.first().json;
return [{ json: { ...data, digest_formatted: true } }];
`;

// Verify the dashboard snapshot request carries a token matching
// $vars.PROCUREMENT_SNAPSHOT_TOKEN. Throws on mismatch so n8n returns a
// non-2xx response — without this the GET /webhook/procurement-dashboard-
// snapshot endpoint exposes the entire vendor registry, audit log, and
// monitor fleet to anyone who knows the URL (finding 6).
//
// We accept the token via either a `?t=` query param or an
// `x-procurement-token` header; the constant-time string compare keeps
// timing-attack surface small (the token is symmetric, not derived from
// HMAC like the dashboard webhooks, so this is the right tier of check).
const SNAPSHOT_VERIFY_TOKEN_CODE = `
const expected = $vars.PROCUREMENT_SNAPSHOT_TOKEN;
if (!expected) {
  throw new Error('snapshot: PROCUREMENT_SNAPSHOT_TOKEN env var is not set. Refusing to serve unauthenticated snapshot.');
}
const query = $json.query || {};
const headers = $json.headers || {};
const presented = query.t || headers['x-procurement-token'] || '';
if (typeof presented !== 'string' || presented.length === 0 || presented.length > 256) {
  throw new Error('snapshot: missing or malformed token');
}
if (presented.length !== expected.length) {
  throw new Error('snapshot: token rejected');
}
let diff = 0;
for (let i = 0; i < expected.length; i++) {
  diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
}
if (diff !== 0) {
  throw new Error('snapshot: token rejected');
}
return [{ json: $json }];
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
