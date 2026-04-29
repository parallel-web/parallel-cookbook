import {
  resetNodeCounter, pos, executeWorkflowTriggerNode,
  codeNode, switchNode, slackNode, googleSheetsNode,
  connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";

export function generateRiskScoringWorkflow(): N8nWorkflow {
  resetNodeCounter();

  const nodes = [
    executeWorkflowTriggerNode("Receive Research Output", pos(0, 0)),
    codeNode("Risk Scorer", SCORING_CODE, pos(1, 0)),
    switchNode("Route by Risk Level", "={{ $json.risk_level }}", ["CRITICAL", "HIGH", "MEDIUM", "LOW"], pos(2, 0)),
    slackNode("Alert Critical", "#procurement-critical", pos(3, -2),
      '={{ "\\ud83d\\udd34 CRITICAL: " + $json.vendor_name + " — " + $json.summary }}'),
    slackNode("Alert High", "#procurement-alerts", pos(3, -1),
      '={{ "\\ud83d\\udfe0 HIGH: " + $json.vendor_name + " — " + $json.summary }}'),
    codeNode("Format Digest Entry", DIGEST_CODE, pos(3, 0)),
    codeNode("Log Low Risk", 'return [$input.first()];', pos(3, 1)),
    googleSheetsNode("Audit Log", "append", "Audit Log", pos(4, 0)),
  ];

  const connections = buildConnections([
    connect("Receive Research Output", "Risk Scorer"),
    connect("Risk Scorer", "Route by Risk Level"),
    connect("Route by Risk Level", "Alert Critical", 0),
    connect("Route by Risk Level", "Alert High", 1),
    connect("Route by Risk Level", "Format Digest Entry", 2),
    connect("Route by Risk Level", "Log Low Risk", 3),
    connect("Alert Critical", "Audit Log"),
    connect("Alert High", "Audit Log"),
    connect("Format Digest Entry", "Audit Log"),
    connect("Log Low Risk", "Audit Log"),
  ]);

  return buildWorkflow("Workflow 3: Risk Scoring & Slack Delivery", nodes, connections);
}

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

const DIGEST_CODE = `
const data = $input.first().json;
return [{ json: { ...data, digest_formatted: true } }];
`;
