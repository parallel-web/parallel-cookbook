import {
  resetNodeCounter, pos, scheduleNode, manualTriggerNode,
  googleSheetsNode, codeNode, httpRequestNode, waitNode, ifNode,
  executeWorkflowNode, connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";

export function generateDeepResearchWorkflow(): N8nWorkflow {
  resetNodeCounter();

  const nodes = [
    scheduleNode("Daily 6AM Trigger", 6, pos(0, 0)),
    manualTriggerNode("Manual Trigger", pos(0, 1)),
    googleSheetsNode("Read Registry", "read", "Registry", pos(1, 0)),
    codeNode("Filter Due Vendors", FILTER_CODE, pos(2, 0)),
    httpRequestNode(
      "Create Task Group",
      "POST",
      "https://api.parallel.ai/v1beta/tasks/groups",
      pos(3, 0),
      '={{ JSON.stringify({}) }}',
    ),
    codeNode("Build Task Runs", BUILD_RUNS_CODE, pos(4, 0)),
    httpRequestNode(
      "Add Runs to Group",
      "POST",
      "=https://api.parallel.ai/v1beta/tasks/groups/{{ $('Create Task Group').item.json.taskgroup_id }}/runs",
      pos(5, 0),
      "={{ $json.runsPayload }}",
    ),
    waitNode("Wait 60s", 60, pos(6, 0)),
    httpRequestNode(
      "Poll Group Status",
      "GET",
      "=https://api.parallel.ai/v1beta/tasks/groups/{{ $('Create Task Group').item.json.taskgroup_id }}",
      pos(7, 0),
    ),
    ifNode("Is Complete?", "={{ $json.status.is_active }}", "false", pos(8, 0)),
    httpRequestNode(
      "Get Results",
      "GET",
      "=https://api.parallel.ai/v1beta/tasks/groups/{{ $('Create Task Group').item.json.taskgroup_id }}/runs?include_output=true",
      pos(9, 0),
    ),
    codeNode("Parse Results", PARSE_RESULTS_CODE, pos(10, 0)),
    executeWorkflowNode("Score & Route (WF3)", pos(11, 0)),
    googleSheetsNode("Update Research Dates", "update", "Registry", pos(12, 0)),
  ];

  const connections = buildConnections([
    connect("Daily 6AM Trigger", "Read Registry"),
    connect("Manual Trigger", "Read Registry"),
    connect("Read Registry", "Filter Due Vendors"),
    connect("Filter Due Vendors", "Create Task Group"),
    connect("Create Task Group", "Build Task Runs"),
    connect("Build Task Runs", "Add Runs to Group"),
    connect("Add Runs to Group", "Wait 60s"),
    connect("Wait 60s", "Poll Group Status"),
    connect("Poll Group Status", "Is Complete?"),
    connect("Is Complete?", "Get Results", 0),      // true → get results
    connect("Is Complete?", "Wait 60s", 1),          // false → loop back
    connect("Get Results", "Parse Results"),
    connect("Parse Results", "Score & Route (WF3)"),
    connect("Score & Route (WF3)", "Update Research Dates"),
  ]);

  return buildWorkflow("Workflow 2: Scheduled Deep Research", nodes, connections);
}

const FILTER_CODE = `
const today = new Date().toISOString().slice(0, 10);
const vendors = $input.all().map(i => i.json);
const due = vendors.filter(v => {
  if (v.active === false || v.active === "false") return false;
  if (!v.next_research_date) return true;
  return v.next_research_date.slice(0, 10) <= today;
});
return due.map(v => ({ json: v }));
`;

const BUILD_RUNS_CODE = `
const vendors = $('Filter Due Vendors').all().map(i => i.json);
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
const inputs = vendors.map(v => ({
  input: "Conduct a vendor risk assessment of " + v.vendor_name + " (" + v.vendor_domain + ").",
  processor: "ultra8x"
}));
return [{ json: { runsPayload: JSON.stringify({ inputs, default_task_spec: { output_schema: outputSchema } }) } }];
`;

const PARSE_RESULTS_CODE = `
const results = $input.all().map(i => i.json);
const vendors = $('Filter Due Vendors').all().map(i => i.json);
const parsed = results.filter(r => r.status === "completed" && r.output).map((r, i) => ({
  json: {
    vendor: vendors[i] || {},
    research_output: r.output.content || r.output,
    run_id: r.run_id,
    status: r.status,
  }
}));
return parsed;
`;
