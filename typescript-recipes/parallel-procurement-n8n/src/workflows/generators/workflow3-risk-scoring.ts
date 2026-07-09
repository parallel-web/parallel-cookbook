import {
  resetNodeCounter, pos, executeWorkflowTriggerNode,
  codeNode, switchNode, slackNode, googleSheetsNode,
  connect, buildConnections, buildWorkflow,
  type N8nWorkflow,
} from "../generator-utils.js";

// WF3 — the shared risk-scoring sink. Inputs come from WF2 (deep
// research), WF4 (monitor events) and WF5 (ad-hoc). The scorer:
//   1. Aggregates severity across the 5 dimensions
//   2. Applies the 2 fixed override rules + the risk_tier_override floor
//   3. Lifts the top-confidence citation per triggered dimension from
//      `input.basis` so the audit log + Slack alert can answer "why was
//      this vendor flagged?" with a source URL.

export function generateRiskScoringWorkflow(): N8nWorkflow {
  resetNodeCounter();

  const nodes = [
    executeWorkflowTriggerNode("Receive Research Output", pos(0, 0)),
    codeNode("Risk Scorer", SCORING_CODE, pos(1, 0)),
    switchNode("Route by Risk Level", "={{ $json.risk_level }}", ["CRITICAL", "HIGH", "MEDIUM", "LOW"], pos(2, 0)),
    slackNode("Alert Critical", "#procurement-critical", pos(3, -2),
      '={{ "\\ud83d\\udd34 CRITICAL: " + $json.vendor_name + " — " + $json.summary + ($json.top_citation_url ? "\\nSource: <" + $json.top_citation_url + "|" + ($json.top_citation_title || $json.top_citation_url) + ">" : "") }}'),
    slackNode("Alert High", "#procurement-alerts", pos(3, -1),
      '={{ "\\ud83d\\udfe0 HIGH: " + $json.vendor_name + " — " + $json.summary + ($json.top_citation_url ? "\\nSource: <" + $json.top_citation_url + "|" + ($json.top_citation_title || $json.top_citation_url) + ">" : "") }}'),
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

// `SCORING_CODE` is verbatim-portable to the combined workflow; keep it
// pure JS so the generator file stays self-contained. The ordering of
// override rules + tie-breaking must match
// src/services/risk-scorer.ts.
export const SCORING_CODE = `
const input = $input.first().json;
const output = input.research_output || input;
const vendor = input.vendor || {};
const basis = Array.isArray(input.basis) ? input.basis : (Array.isArray(output.basis) ? output.basis : []);

const RISK_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 };
const DIMENSION_KEYS = ['financial_health','legal_regulatory','cybersecurity','leadership_governance','esg_reputation'];

// ── Step 1: severity aggregation ─────────────────────────────────────
const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
const categories = [];
const mediumCats = [];
for (const dim of DIMENSION_KEYS) {
  const sev = ((output[dim] && output[dim].severity) || 'LOW').toUpperCase();
  counts[sev] = (counts[sev] || 0) + 1;
  if (sev === 'CRITICAL' || sev === 'HIGH') categories.push(dim);
  if (sev === 'MEDIUM') mediumCats.push(dim);
}

// ── Step 2: risk level assignment ────────────────────────────────────
let risk_level, adverse_flag;
if (counts.CRITICAL > 0) { risk_level = 'CRITICAL'; adverse_flag = true; }
else if (counts.HIGH >= 1) { risk_level = 'HIGH'; adverse_flag = true; }
else if (counts.MEDIUM >= 3) { risk_level = 'MEDIUM'; adverse_flag = new Set(mediumCats).size >= 2; }
else if (counts.MEDIUM >= 1) { risk_level = 'MEDIUM'; adverse_flag = false; }
else { risk_level = 'LOW'; adverse_flag = false; }

if (counts.MEDIUM >= 3 && adverse_flag) {
  for (const cat of mediumCats) {
    if (!categories.includes(cat)) categories.push(cat);
  }
}

// ── Step 3: overrides ────────────────────────────────────────────────
const overrides = [];
if (((output.cybersecurity && output.cybersecurity.status) || '').toUpperCase() === 'CRITICAL') {
  if (RISK_ORDER[risk_level] < RISK_ORDER.CRITICAL) risk_level = 'CRITICAL';
  adverse_flag = true;
  overrides.push('active_data_breach');
  if (!categories.includes('cybersecurity')) categories.push('cybersecurity');
}
if (((output.legal_regulatory && output.legal_regulatory.status) || '').toUpperCase() === 'CRITICAL') {
  if (RISK_ORDER[risk_level] < RISK_ORDER.HIGH) risk_level = 'HIGH';
  adverse_flag = true;
  overrides.push('active_government_litigation');
  if (!categories.includes('legal_regulatory')) categories.push('legal_regulatory');
}

// risk_tier_override on the Vendors sheet acts as a FLOOR — never scores below.
const tierOverride = vendor.risk_tier_override || input.risk_tier_override;
if (tierOverride && RISK_ORDER[tierOverride] != null && RISK_ORDER[tierOverride] > RISK_ORDER[risk_level]) {
  risk_level = tierOverride;
  overrides.push('risk_tier_override_' + tierOverride);
}

// ── Step 4: derived fields ───────────────────────────────────────────
const action_required = risk_level === 'HIGH' || risk_level === 'CRITICAL';
const recMap = { LOW: 'continue_monitoring', MEDIUM: 'escalate_review', HIGH: 'initiate_contingency', CRITICAL: 'suspend_relationship' };
const recommendation = recMap[risk_level];
const vendor_name = output.vendor_name || vendor.vendor_name || 'Unknown';
const summary = vendor_name + ' assessed at ' + risk_level + ' risk. ' + (adverse_flag ? 'Adverse conditions detected.' : 'No adverse conditions.');

// ── Step 5: basis plumbing (top citation per triggered dimension) ───
const basisByDim = {};
for (const entry of basis) {
  const field = entry.field || '';
  const dim = DIMENSION_KEYS.find(d => field === d || field.startsWith(d + '.'));
  if (!dim) continue;
  if (!basisByDim[dim]) basisByDim[dim] = [];
  basisByDim[dim].push(entry);
}

const topCitations = [];
for (const dim of categories) {
  const entries = basisByDim[dim];
  if (!entries || entries.length === 0) continue;
  const sorted = entries.slice().sort((a, b) =>
    (CONFIDENCE_RANK[(b.confidence || '').toLowerCase()] || 0) -
    (CONFIDENCE_RANK[(a.confidence || '').toLowerCase()] || 0)
  );
  for (const entry of sorted) {
    const cite = (entry.citations || [])[0];
    if (!cite || !cite.url) continue;
    topCitations.push({
      dimension: dim,
      url: cite.url,
      title: cite.title || null,
      reasoning: entry.reasoning || null,
      confidence: entry.confidence || null,
    });
    break;
  }
  if (topCitations.length >= 3) break;
}
const top = topCitations[0] || null;

return [{
  json: {
    vendor_name, risk_level, adverse_flag, action_required, recommendation,
    summary, categories, severity_counts: counts, triggered_overrides: overrides,
    assessment_date: new Date().toISOString().slice(0, 10),
    source: input.source || 'deep_research',
    run_id: input.run_id || '',
    // Audit-row columns — surface the top citation alongside the existing
    // fields so the row alone answers "why was this flagged".
    top_citation_url: top ? top.url : null,
    top_citation_title: top ? top.title : null,
    confidence: top ? top.confidence : null,
    top_citations: topCitations,
    basis_per_dimension: basisByDim,
  }
}];
`;

const DIGEST_CODE = `
const data = $input.first().json;
return [{ json: { ...data, digest_formatted: true } }];
`;
