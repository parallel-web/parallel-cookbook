import {
  resetNodeCounter, pos, executeWorkflowTriggerNode, webhookNode,
  codeNode, parallelSdkCodeNode, splitInBatchesNode, googleSheetsNode,
  executeWorkflowNode, connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";
import {
  SDK_CREATE_MONITOR_CODE,
  buildMonitorQueryCode,
  MONITOR_PARSE_WEBHOOK_CODE,
  MONITOR_FETCH_EVENT_CODE,
} from "../shared-code-blocks.js";

// WF4 has two disconnected subgraphs:
//   A. Deploy monitors via client.monitor.create (V1).
//   B. On webhook, fetch the matching execution's event with
//      client.monitor.events({ event_group_id }), parse the V1 typed
//      output (basis carries citations), then hand to WF3.

const QUERY_GEN_CODE = buildMonitorQueryCode(
  "Generate Monitor Queries received empty vendor input. Pass vendor_name/vendor_domain in webhook payload.",
  "/webhook/monitor-events",
);

export function generateMonitorWorkflow(): N8nWorkflow {
  resetNodeCounter();

  const nodes = [
    // Sub-flow A: Deploy monitors
    executeWorkflowTriggerNode("Deploy Trigger", pos(0, -1)),
    codeNode("Generate Monitor Queries", QUERY_GEN_CODE, pos(1, -1)),
    splitInBatchesNode("Loop Monitors", 1, pos(2, -1)),
    parallelSdkCodeNode("Create Monitor", SDK_CREATE_MONITOR_CODE, pos(3, -1)),
    googleSheetsNode("Record Monitor IDs", "append", "Monitors", pos(4, -1)),

    // Sub-flow B: Inbound webhook events
    webhookNode("Monitor Event Webhook", "/webhook/monitor-events", pos(0, 1)),
    codeNode("Parse Webhook Payload", MONITOR_PARSE_WEBHOOK_CODE, pos(1, 1)),
    parallelSdkCodeNode("Fetch Event Details", MONITOR_FETCH_EVENT_CODE, pos(2, 1)),
    codeNode("Enrich & Classify Event", WF4_ENRICH_CODE, pos(3, 1)),
    executeWorkflowNode("Score Event (WF3)", pos(4, 1)),
  ];

  const connections = buildConnections([
    connect("Deploy Trigger", "Generate Monitor Queries"),
    connect("Generate Monitor Queries", "Loop Monitors"),
    connect("Loop Monitors", "Create Monitor", 0),
    connect("Create Monitor", "Loop Monitors"),
    connect("Loop Monitors", "Record Monitor IDs", 1),
    connect("Monitor Event Webhook", "Parse Webhook Payload"),
    connect("Parse Webhook Payload", "Fetch Event Details"),
    connect("Fetch Event Details", "Enrich & Classify Event"),
    connect("Enrich & Classify Event", "Score Event (WF3)"),
  ]);

  return buildWorkflow("Workflow 4: Monitor Deployment & Event Routing", nodes, connections);
}

// WF4's enrich step produces a "flat" output (no vendor field nesting) —
// it differs slightly from the combined workflow's enrich which also
// builds a research_output shape for the inline scorer. Keep that
// distinction explicit here.
const WF4_ENRICH_CODE = `
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

return [{ json: {
  monitor_id: data.monitor_id,
  event_group_id: data.event_group_id,
  metadata: data.metadata || {},
  event_id: entry ? entry.event_id : null,
  event_date: entry ? entry.event_date : null,
  event_summary: output.event_summary || '',
  severity: output.severity || 'LOW',
  adverse: !!output.adverse,
  event_type: output.event_type || (data.metadata && data.metadata.risk_dimension) || 'unknown',
  basis,
  source: 'monitor_event',
} }];
`;
