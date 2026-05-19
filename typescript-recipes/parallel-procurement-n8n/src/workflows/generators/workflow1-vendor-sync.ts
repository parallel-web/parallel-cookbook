import {
  resetNodeCounter, pos, scheduleNode, manualTriggerNode,
  googleSheetsNode, codeNode, parallelSdkCodeNode, splitInBatchesNode,
  connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";
import {
  SDK_CREATE_MONITOR_CODE,
  SDK_CANCEL_MONITOR_CODE,
  buildMonitorQueryCode,
} from "../shared-code-blocks.js";

// WF1 keeps the deployed Parallel monitor fleet in sync with the Vendors
// sheet. Every API call goes through the official parallel-web SDK
// (client.monitor.create / client.monitor.cancel) on V1 endpoints.

const MONITOR_PAYLOAD_CODE = buildMonitorQueryCode(
  "Build Monitor Payload received an empty vendor row.",
  "/webhook/parallel-monitor-event",
);

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
    parallelSdkCodeNode("Create Monitor", SDK_CREATE_MONITOR_CODE, pos(6, -1)),
    splitInBatchesNode("Loop Removed Vendors", 1, pos(4, 1)),
    parallelSdkCodeNode("Cancel Monitor", SDK_CANCEL_MONITOR_CODE, pos(5, 1)),
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
    connect("Loop Removed Vendors", "Cancel Monitor", 0),
    connect("Cancel Monitor", "Loop Removed Vendors"),
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
