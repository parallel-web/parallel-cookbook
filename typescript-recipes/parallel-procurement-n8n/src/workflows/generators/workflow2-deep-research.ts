import {
  resetNodeCounter, pos, scheduleNode, manualTriggerNode,
  googleSheetsNode, codeNode, parallelSdkCodeNode,
  executeWorkflowNode, connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";
import {
  RESEARCH_FILTER_CODE,
  RESEARCH_RUN_GROUP_CODE,
  RESEARCH_PARSE_RESULTS_CODE,
} from "../shared-code-blocks.js";

// WF2 (deep research). Every Parallel HTTP call is now an SDK call:
//   - client.taskGroup.create()  — create group
//   - client.taskGroup.addRuns() — submit one run per due vendor
//   - client.taskGroup.retrieve() — poll group status
//   - client.taskGroup.getRuns()  — stream completed runs with output+basis
//
// All Code-node bodies live in shared-code-blocks.ts so WF2 and the
// combined workflow can't drift (e.g. `runIdByDomain` vs `runIdToDomain`).
// The shared RESEARCH_RUN_GROUP_CODE also emits an ops_report counting any
// in-flight runs after the 1h cap so operators don't silently re-cycle
// the same vendors every day (finding 18).

export function generateDeepResearchWorkflow(): N8nWorkflow {
  resetNodeCounter();

  const nodes = [
    scheduleNode("Daily 6AM Trigger", 6, pos(0, 0)),
    manualTriggerNode("Manual Trigger", pos(0, 1)),
    googleSheetsNode("Read Registry", "read", "Registry", pos(1, 0)),
    codeNode("Filter Due Vendors", RESEARCH_FILTER_CODE, pos(2, 0)),
    parallelSdkCodeNode("Run Task Group", RESEARCH_RUN_GROUP_CODE, pos(3, 0)),
    codeNode("Parse Results", RESEARCH_PARSE_RESULTS_CODE, pos(4, 0)),
    executeWorkflowNode("Score & Route (WF3)", pos(5, 0)),
    googleSheetsNode("Update Research Dates", "update", "Registry", pos(6, 0)),
  ];

  const connections = buildConnections([
    connect("Daily 6AM Trigger", "Read Registry"),
    connect("Manual Trigger", "Read Registry"),
    connect("Read Registry", "Filter Due Vendors"),
    connect("Filter Due Vendors", "Run Task Group"),
    connect("Run Task Group", "Parse Results"),
    connect("Parse Results", "Score & Route (WF3)"),
    connect("Score & Route (WF3)", "Update Research Dates"),
  ]);

  return buildWorkflow("Workflow 2: Scheduled Deep Research", nodes, connections);
}
