import {
  resetNodeCounter, pos, webhookNode, codeNode,
  httpRequestNode, slackNode, executeWorkflowNode,
  connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";

export function generateAdHocWorkflow(): N8nWorkflow {
  resetNodeCounter();

  const nodes = [
    // Slash command entry
    webhookNode("Slack Command", "/webhook/slack-command", pos(0, 0)),
    codeNode("Parse Command", PARSE_CMD_CODE, pos(1, 0)),
    slackNode("Send Acknowledgment", "={{ $json.channel_id }}", pos(2, 0),
      '={{ "\\ud83d\\udd0d Starting deep research on *" + $json.vendor_name + "*. This typically takes 15-30 minutes..." }}'),
    httpRequestNode(
      "Start Research Task",
      "POST",
      "https://api.parallel.ai/v1/tasks/runs",
      pos(3, 0),
      "={{ $json.taskPayload }}",
      "Creates a single deep research run with webhook callback",
    ),

    // Result callback entry
    webhookNode("Result Callback", "/webhook/adhoc-result", pos(0, 2)),
    codeNode("Extract Run ID", 'const d = $input.first().json;\nreturn [{ json: { run_id: d.run_id || d.data?.run_id, status: d.status || d.data?.status } }];', pos(1, 2)),
    httpRequestNode(
      "Get Research Result",
      "GET",
      "=https://api.parallel.ai/v1/tasks/runs/{{ $json.run_id }}/result",
      pos(2, 2),
    ),
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
  taskPayload: JSON.stringify({
    input: prompt,
    processor: "ultra8x",
    task_spec: { output_schema: outputSchema },
    webhook: { url: $vars.N8N_WEBHOOK_BASE_URL + "/webhook/adhoc-result", events: ["task_run.status"] }
  })
} }];
`;
