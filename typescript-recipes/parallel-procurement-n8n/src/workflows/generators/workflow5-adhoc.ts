import {
  resetNodeCounter, pos, webhookNode, codeNode,
  parallelSdkCodeNode, slackNode, executeWorkflowNode,
  connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";

// WF5 — /vendor-research slash command. Two webhook entry points stitched
// together by the Parallel run_id. Both API calls go through the
// parallel-web SDK:
//   - Inbound subgraph: client.taskRun.create({ webhook }) kicks off the
//     run with a callback configured.
//   - Callback subgraph: client.taskRun.result(run_id) returns
//     `{ output: { content, basis }, run }`. We forward basis to WF3 so
//     the thread reply renders source URLs.

export function generateAdHocWorkflow(): N8nWorkflow {
  resetNodeCounter();

  const nodes = [
    webhookNode("Slack Command", "/webhook/slack-command", pos(0, 0)),
    codeNode("Parse Command", PARSE_CMD_CODE, pos(1, 0)),
    slackNode("Send Acknowledgment", "={{ $json.channel_id }}", pos(2, 0),
      '={{ "\\ud83d\\udd0d Starting deep research on *" + $json.vendor_name + "*. This typically takes 15-30 minutes..." }}'),
    parallelSdkCodeNode("Start Research Task", START_TASK_CODE, pos(3, 0)),

    webhookNode("Result Callback", "/webhook/adhoc-result", pos(0, 2)),
    codeNode("Extract Run ID", EXTRACT_RUN_ID_CODE, pos(1, 2)),
    parallelSdkCodeNode("Get Research Result", GET_RESULT_CODE, pos(2, 2)),
    executeWorkflowNode("Score Result (WF3)", pos(3, 2)),
    slackNode("Post Thread Reply", "={{ $json.channel_id }}", pos(4, 2),
      '={{ $json.text }}'),
  ];

  const connections = buildConnections([
    connect("Slack Command", "Parse Command"),
    connect("Parse Command", "Send Acknowledgment"),
    connect("Send Acknowledgment", "Start Research Task"),
    connect("Result Callback", "Extract Run ID"),
    connect("Extract Run ID", "Get Research Result"),
    connect("Get Research Result", "Score Result (WF3)"),
    connect("Score Result (WF3)", "Post Thread Reply"),
  ]);

  return buildWorkflow("Workflow 5: Ad-Hoc Research via Slack", nodes, connections);
}

const PARSE_CMD_CODE = `
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

const START_TASK_CODE = `
const item = $json;
const run = await client.taskRun.create({
  input: item.prompt,
  processor: $vars.RESEARCH_PROCESSOR || 'ultra8x',
  task_spec: { output_schema: item.outputSchema },
  webhook: {
    url: ($vars.N8N_WEBHOOK_BASE_URL || '') + '/webhook/adhoc-result',
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

// Short-circuit when the run hasn't completed yet — the task_run.status
// webhook fires for queued/running/action_required/cancelling too. Returning
// an empty array drops the item so the downstream client.taskRun.result()
// call doesn't run against a non-terminal run.
const EXTRACT_RUN_ID_CODE = `
const d = $input.first().json;
const run_id = d.run_id || (d.data && d.data.run_id);
const status = d.status || (d.data && d.data.status);
if (status && status !== 'completed') {
  return [];
}
return [{ json: { run_id, status } }];
`;

// V1 result fetch — returns { output: { type, content, basis }, run }.
// We forward both content and basis so WF3 can lift the top citation.
const GET_RESULT_CODE = `
const runId = $json.run_id;
if (!runId) {
  throw new Error('Get Research Result: missing run_id on input.');
}
const result = await client.taskRun.result(runId);
return [{ json: {
  ...$json,
  research_output: result.output && result.output.content,
  basis: (result.output && result.output.basis) || [],
  source: 'adhoc',
} }];
`;
