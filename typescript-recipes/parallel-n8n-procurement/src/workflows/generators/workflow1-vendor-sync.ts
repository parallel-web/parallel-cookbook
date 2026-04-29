import {
  resetNodeCounter, pos, scheduleNode, manualTriggerNode,
  googleSheetsNode, codeNode, httpRequestNode, splitInBatchesNode,
  connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";

export function generateVendorSyncWorkflow(): N8nWorkflow {
  resetNodeCounter();

  const nodes = [
    scheduleNode("Daily Sync Trigger", 0, pos(0, 0)),
    manualTriggerNode("Manual Trigger", pos(0, 1)),
    googleSheetsNode("Read Vendor List", "read", "Vendors", pos(1, 0)),
    googleSheetsNode("Read Previous Registry", "read", "Registry", pos(2, 0)),
    codeNode("Compute Diff", DIFF_CODE, pos(3, 0)),
    splitInBatchesNode("Loop Added Vendors", 1, pos(4, -1)),
    codeNode("Build Monitor Payload", MONITOR_PAYLOAD_CODE, pos(5, -1)),
    httpRequestNode(
      "Create Monitor",
      "POST",
      "https://api.parallel.ai/v1alpha/monitors",
      pos(6, -1),
      "={{ JSON.stringify($json.monitorPayload) }}",
    ),
    splitInBatchesNode("Loop Removed Vendors", 1, pos(4, 1)),
    httpRequestNode(
      "Delete Monitor",
      "DELETE",
      "=https://api.parallel.ai/v1alpha/monitors/{{ $json.monitor_id }}",
      pos(5, 1),
    ),
    googleSheetsNode("Update Registry", "update", "Registry", pos(7, 0)),
  ];

  const connections = buildConnections([
    connect("Daily Sync Trigger", "Read Vendor List"),
    connect("Manual Trigger", "Read Vendor List"),
    connect("Read Vendor List", "Read Previous Registry"),
    connect("Read Previous Registry", "Compute Diff"),
    connect("Compute Diff", "Loop Added Vendors", 0),
    connect("Compute Diff", "Loop Removed Vendors", 0),
    connect("Loop Added Vendors", "Build Monitor Payload", 0),
    connect("Build Monitor Payload", "Create Monitor"),
    connect("Create Monitor", "Loop Added Vendors"),
    connect("Loop Added Vendors", "Update Registry", 1),
    connect("Loop Removed Vendors", "Delete Monitor", 0),
    connect("Delete Monitor", "Loop Removed Vendors"),
    connect("Loop Removed Vendors", "Update Registry", 1),
  ]);

  return buildWorkflow("Workflow 1: Vendor Ingestion & Sync", nodes, connections);
}

const DIFF_CODE = `
const incoming = $('Read Vendor List').all().map(i => i.json);
const previous = $('Read Previous Registry').all().map(i => i.json);

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

const MONITOR_PAYLOAD_CODE = `
const vendor = $json;
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
