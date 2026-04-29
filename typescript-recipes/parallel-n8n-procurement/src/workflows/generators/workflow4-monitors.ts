import {
  resetNodeCounter, pos, executeWorkflowTriggerNode, webhookNode,
  codeNode, httpRequestNode, splitInBatchesNode, googleSheetsNode,
  executeWorkflowNode, connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";

export function generateMonitorWorkflow(): N8nWorkflow {
  resetNodeCounter();

  const nodes = [
    // Sub-flow A: Deploy monitors (triggered by Execute Workflow)
    executeWorkflowTriggerNode("Deploy Trigger", pos(0, -1)),
    codeNode("Generate Monitor Queries", QUERY_GEN_CODE, pos(1, -1)),
    splitInBatchesNode("Loop Monitors", 1, pos(2, -1)),
    httpRequestNode(
      "Create Monitor",
      "POST",
      "https://api.parallel.ai/v1alpha/monitors",
      pos(3, -1),
      "={{ JSON.stringify($json.monitorPayload) }}",
    ),
    googleSheetsNode("Record Monitor IDs", "append", "Monitors", pos(4, -1)),

    // Sub-flow B: Inbound webhook events
    webhookNode("Monitor Event Webhook", "/webhook/monitor-events", pos(0, 1)),
    codeNode("Parse Webhook Payload", PARSE_WEBHOOK_CODE, pos(1, 1)),
    httpRequestNode(
      "Fetch Event Details",
      "GET",
      "=https://api.parallel.ai/v1alpha/monitors/{{ $json.monitor_id }}/event_groups/{{ $json.event_group_id }}",
      pos(2, 1),
    ),
    codeNode("Enrich & Classify Event", ENRICH_CODE, pos(3, 1)),
    executeWorkflowNode("Score Event (WF3)", pos(4, 1)),
  ];

  const connections = buildConnections([
    // Sub-flow A
    connect("Deploy Trigger", "Generate Monitor Queries"),
    connect("Generate Monitor Queries", "Loop Monitors"),
    connect("Loop Monitors", "Create Monitor", 0),
    connect("Create Monitor", "Loop Monitors"),
    connect("Loop Monitors", "Record Monitor IDs", 1),
    // Sub-flow B
    connect("Monitor Event Webhook", "Parse Webhook Payload"),
    connect("Parse Webhook Payload", "Fetch Event Details"),
    connect("Fetch Event Details", "Enrich & Classify Event"),
    connect("Enrich & Classify Event", "Score Event (WF3)"),
  ]);

  return buildWorkflow("Workflow 4: Monitor Deployment & Event Routing", nodes, connections);
}

const QUERY_GEN_CODE = `
const vendor = $input.first().json;
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

const PARSE_WEBHOOK_CODE = `
const payload = $input.first().json;
return [{ json: { monitor_id: payload.data.monitor_id, event_group_id: payload.data.event.event_group_id, metadata: payload.data.metadata || {} } }];
`;

const ENRICH_CODE = `
const eventData = $input.first().json;
const webhookData = $('Parse Webhook Payload').item.json;
const events = eventData.events || [];
const eventEntry = events.find(e => e.type === 'event');
let output = {};
if (eventEntry && eventEntry.output && typeof eventEntry.output === 'object') {
  output = eventEntry.output;
} else if (eventEntry && typeof eventEntry.output === 'string') {
  output = { event_summary: eventEntry.output, severity: 'LOW', adverse: false, event_type: 'unknown' };
}
return [{ json: { ...webhookData, ...output, source: 'monitor_event', event_date: eventEntry?.event_date, source_urls: eventEntry?.source_urls } }];
`;
