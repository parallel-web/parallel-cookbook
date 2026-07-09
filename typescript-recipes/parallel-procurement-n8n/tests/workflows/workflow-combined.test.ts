import { describe, it, expect } from "vitest";
import { generateCombinedWorkflow } from "@/workflows/generators/workflow-combined.js";
import type { N8nWorkflow } from "@/workflows/generator-utils.js";

// ── Shared Validator ──────────────────────────────────────────────────────

function validateWorkflow(wf: N8nWorkflow) {
  expect(typeof wf.name).toBe("string");
  expect(wf.name.length).toBeGreaterThan(0);
  expect(Array.isArray(wf.nodes)).toBe(true);
  expect(wf.nodes.length).toBeGreaterThan(0);
  expect(typeof wf.connections).toBe("object");
  expect(wf.settings).toBeDefined();

  const nodeNames = new Set<string>();
  for (const node of wf.nodes) {
    expect(typeof node.id).toBe("string");
    expect(typeof node.name).toBe("string");
    expect(typeof node.type).toBe("string");
    expect(node.type).toMatch(/^n8n-nodes-(base|parallel)\./);
    expect(Array.isArray(node.position)).toBe(true);
    expect(node.position).toHaveLength(2);
    expect(typeof node.position[0]).toBe("number");
    expect(typeof node.position[1]).toBe("number");
    expect(typeof node.typeVersion).toBe("number");
    expect(typeof node.parameters).toBe("object");
    expect(nodeNames.has(node.name)).toBe(false);
    nodeNames.add(node.name);
  }

  for (const [fromName, conn] of Object.entries(wf.connections)) {
    expect(nodeNames.has(fromName)).toBe(true);
    for (const outputs of conn.main) {
      for (const target of outputs) {
        expect(nodeNames.has(target.node)).toBe(true);
        expect(target.type).toBe("main");
        expect(typeof target.index).toBe("number");
      }
    }
  }
}

function hasNodeName(wf: N8nWorkflow, name: string): boolean {
  return wf.nodes.some((n) => n.name === name);
}

function getNodesByType(wf: N8nWorkflow, type: string) {
  return wf.nodes.filter((n) => n.type === `n8n-nodes-base.${type}`);
}

function connectsTo(wf: N8nWorkflow, from: string, to: string): boolean {
  const conn = wf.connections[from];
  if (!conn) return false;
  return conn.main.some((outputs) => outputs.some((c) => c.node === to));
}

// ── Tests ─────────────────────────────────────────────────────────────────

const wf = generateCombinedWorkflow();

describe("Combined Workflow — structure", () => {
  it("generates valid n8n workflow structure", () => {
    validateWorkflow(wf);
  });

  it("has no duplicate node names", () => {
    const names = wf.nodes.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has zero executeWorkflow nodes", () => {
    expect(getNodesByType(wf, "executeWorkflow")).toHaveLength(0);
  });

  it("has zero executeWorkflowTrigger nodes", () => {
    expect(getNodesByType(wf, "executeWorkflowTrigger")).toHaveLength(0);
  });
});

describe("Combined Workflow — V1 migration invariants", () => {
  it("never references /v1alpha/ in any node parameter", () => {
    for (const node of wf.nodes) {
      const serialized = JSON.stringify(node.parameters);
      expect(serialized).not.toContain("/v1alpha/");
    }
  });

  it("every Parallel-touching Code node requires('parallel-web')", () => {
    const sdkNodes = wf.nodes.filter(
      (n) =>
        n.type === "n8n-nodes-base.code" &&
        String((n.parameters as { jsCode?: string }).jsCode ?? "").includes(
          "client.monitor",
        ) ||
        String((n.parameters as { jsCode?: string }).jsCode ?? "").includes(
          "client.taskRun",
        ) ||
        String((n.parameters as { jsCode?: string }).jsCode ?? "").includes(
          "client.taskGroup",
        ),
    );
    // We have at minimum: sync create, sync cancel, monitor create,
    // monitor fetch event, adhoc start, adhoc fetch result, research run group.
    expect(sdkNodes.length).toBeGreaterThanOrEqual(6);
    for (const node of sdkNodes) {
      const code = String((node.parameters as { jsCode?: string }).jsCode ?? "");
      expect(code).toContain("require('parallel-web')");
    }
  });

  it("has zero httpRequestNode calls to api.parallel.ai", () => {
    const httpNodes = getNodesByType(wf, "httpRequest");
    const parallelHttp = httpNodes.filter((n) =>
      String((n.parameters as { url?: string }).url ?? "").includes(
        "api.parallel.ai",
      ),
    );
    expect(parallelHttp).toHaveLength(0);
  });
});

describe("Combined Workflow — triggers", () => {
  it("has exactly 2 schedule triggers", () => {
    expect(getNodesByType(wf, "scheduleTrigger")).toHaveLength(2);
  });

  it("has midnight sync trigger", () => {
    expect(hasNodeName(wf, "Sync: Daily Midnight Trigger")).toBe(true);
  });

  it("has 6AM research trigger", () => {
    expect(hasNodeName(wf, "Research: Daily 6AM Trigger")).toBe(true);
  });

  it("has 5 webhook triggers and no Parallel trigger dependency", () => {
    expect(getNodesByType(wf, "webhook")).toHaveLength(5);
    const parallelTriggers = wf.nodes.filter((n) =>
      n.type.includes("parallelMonitorTrigger") || n.type.includes("parallelTrigger"),
    );
    expect(parallelTriggers.length).toBe(0);
  });

  it("has deploy-monitors webhook", () => {
    const wh = wf.nodes.find(
      (n) => n.type === "n8n-nodes-base.webhook" && String(n.parameters.path).includes("deploy-monitors"),
    );
    expect(wh).toBeDefined();
  });

  it("has monitor event webhook trigger", () => {
    const trigger = wf.nodes.find(
      (n) => n.type === "n8n-nodes-base.webhook" && String(n.parameters.path).includes("parallel-monitor-event"),
    );
    expect(trigger).toBeDefined();
    expect(trigger!.parameters.httpMethod).toBe("POST");
  });

  it("has slack-command webhook", () => {
    const wh = wf.nodes.find(
      (n) => n.type === "n8n-nodes-base.webhook" && String(n.parameters.path).includes("slack-command"),
    );
    expect(wh).toBeDefined();
  });

  it("has task completion webhook trigger", () => {
    const trigger = wf.nodes.find(
      (n) => n.type === "n8n-nodes-base.webhook" && String(n.parameters.path).includes("parallel-task-completion"),
    );
    expect(trigger).toBeDefined();
    expect(trigger!.parameters.httpMethod).toBe("POST");
  });

  it("has snapshot dashboard webhook trigger", () => {
    const wh = wf.nodes.find(
      (n) => n.type === "n8n-nodes-base.webhook" && String(n.parameters.path).includes("procurement-dashboard-snapshot"),
    );
    expect(wh).toBeDefined();
    expect(wh!.parameters.httpMethod).toBe("GET");
  });
});

describe("Combined Workflow — Sync flow (WF1)", () => {
  it("has diff code node", () => {
    expect(hasNodeName(wf, "Sync: Compute Diff")).toBe(true);
  });

  it("has SDK-backed monitor creation and cancellation", () => {
    expect(hasNodeName(wf, "Sync: Create Monitor")).toBe(true);
    expect(hasNodeName(wf, "Sync: Cancel Monitor")).toBe(true);
    const create = wf.nodes.find((n) => n.name === "Sync: Create Monitor");
    expect(create!.type).toBe("n8n-nodes-base.code");
    expect(String((create!.parameters as { jsCode?: string }).jsCode)).toContain(
      "client.monitor.create",
    );
    const cancel = wf.nodes.find((n) => n.name === "Sync: Cancel Monitor");
    expect(cancel!.type).toBe("n8n-nodes-base.code");
    expect(String((cancel!.parameters as { jsCode?: string }).jsCode)).toContain(
      "client.monitor.cancel",
    );
  });

  it("diff code references prefixed node names", () => {
    const diff = wf.nodes.find((n) => n.name === "Sync: Compute Diff");
    const code = String(diff!.parameters.jsCode);
    expect(code).toContain("Sync: Read Vendor List");
    expect(code).toContain("Sync: Read Previous Registry");
  });
});

describe("Combined Workflow — Research flow (WF2)", () => {
  it("uses an SDK Code node to drive the Task Group lifecycle", () => {
    const node = wf.nodes.find((n) => n.name === "Research: Run Task Group");
    expect(node).toBeDefined();
    expect(node!.type).toBe("n8n-nodes-base.code");
    const code = String((node!.parameters as { jsCode?: string }).jsCode);
    expect(code).toContain("client.taskGroup.create");
    expect(code).toContain("client.taskGroup.addRuns");
    expect(code).toContain("client.taskGroup.getRuns");
  });

  it("batches at 50 vendors per addRuns call (PRD limit)", () => {
    const node = wf.nodes.find((n) => n.name === "Research: Run Task Group");
    const code = String((node!.parameters as { jsCode?: string }).jsCode);
    expect(code).toContain("BATCH = 50");
  });

  it("Parse Results forwards basis to the scoring fan-in", () => {
    const node = wf.nodes.find((n) => n.name === "Research: Parse Results");
    expect(node).toBeDefined();
    const code = String((node!.parameters as { jsCode?: string }).jsCode);
    expect(code).toContain("basis");
    expect(code).toContain("'deep_research'");
  });
});

describe("Combined Workflow — Monitor flows (WF4)", () => {
  it("has monitor deploy webhook", () => {
    expect(hasNodeName(wf, "Monitor: Deploy Webhook")).toBe(true);
  });

  it("has SDK-backed monitor creation in deploy flow", () => {
    expect(hasNodeName(wf, "Monitor: Create Monitor")).toBe(true);
    const node = wf.nodes.find((n) => n.name === "Monitor: Create Monitor");
    expect(node!.type).toBe("n8n-nodes-base.code");
    expect(String((node!.parameters as { jsCode?: string }).jsCode)).toContain(
      "client.monitor.create",
    );
  });

  it("Fetch Event Details uses client.monitor.events with event_group_id", () => {
    const node = wf.nodes.find((n) => n.name === "Monitor: Fetch Event Details");
    expect(node).toBeDefined();
    expect(node!.type).toBe("n8n-nodes-base.code");
    const code = String((node!.parameters as { jsCode?: string }).jsCode);
    expect(code).toContain("client.monitor.events");
    expect(code).toContain("event_group_id");
  });

  it("Enrich & Classify Event reads V1 output.content + output.basis", () => {
    const enrich = wf.nodes.find((n) => n.name === "Monitor: Enrich & Classify Event");
    const code = String(enrich!.parameters.jsCode);
    expect(code).toContain("event_type === 'event_stream'");
    expect(code).toContain("basis");
    expect(code).toContain("source: 'monitor_event'");
  });
});

describe("Combined Workflow — Ad-Hoc flow (WF5)", () => {
  it("has slash command and result callback webhooks", () => {
    expect(hasNodeName(wf, "AdHoc: Slack Command")).toBe(true);
    expect(hasNodeName(wf, "AdHoc: Result Callback")).toBe(true);
  });

  it("uses client.taskRun.create for the deep research kickoff", () => {
    const node = wf.nodes.find((n) => n.name === "AdHoc: Start Research Task");
    expect(node).toBeDefined();
    expect(node!.type).toBe("n8n-nodes-base.code");
    expect(String((node!.parameters as { jsCode?: string }).jsCode)).toContain(
      "client.taskRun.create",
    );
  });

  it("uses client.taskRun.result on the callback", () => {
    const node = wf.nodes.find((n) => n.name === "AdHoc: Fetch Result");
    expect(node).toBeDefined();
    expect(String((node!.parameters as { jsCode?: string }).jsCode)).toContain(
      "client.taskRun.result",
    );
  });

  it("has Tag Source code node with source: adhoc", () => {
    const tag = wf.nodes.find((n) => n.name === "AdHoc: Tag Source");
    expect(tag).toBeDefined();
    const code = String(tag!.parameters.jsCode);
    expect(code).toContain("source: 'adhoc'");
  });

  it("has thread reply Slack node", () => {
    expect(hasNodeName(wf, "AdHoc: Post Thread Reply")).toBe(true);
  });
});

describe("Combined Workflow — Shared Scoring Chain", () => {
  it("Risk Scorer cascades severity → overrides → basis plumbing", () => {
    const scorer = wf.nodes.find((n) => n.name === "Scoring: Risk Scorer");
    expect(scorer).toBeDefined();
    const code = String(scorer!.parameters.jsCode);
    expect(code).toContain("CRITICAL");
    expect(code).toContain("severity");
    expect(code).toContain("active_data_breach");
    expect(code).toContain("active_government_litigation");
    // V1 additions
    expect(code).toContain("risk_tier_override");
    expect(code).toContain("top_citations");
    expect(code).toContain("basis");
  });

  it("has Route by Risk Level switch", () => {
    expect(hasNodeName(wf, "Scoring: Route by Risk Level")).toBe(true);
  });

  it("has Slack alert nodes", () => {
    expect(hasNodeName(wf, "Scoring: Alert Critical")).toBe(true);
    expect(hasNodeName(wf, "Scoring: Alert High")).toBe(true);
  });

  it("Slack alerts surface the top citation URL when present", () => {
    const critical = wf.nodes.find((n) => n.name === "Scoring: Alert Critical");
    const text = String((critical!.parameters as { text?: string }).text ?? "");
    expect(text).toContain("top_citation_url");
  });

  it("has Audit Log", () => {
    const log = wf.nodes.find((n) => n.name === "Scoring: Audit Log");
    expect(log).toBeDefined();
    expect(log!.parameters.operation).toBe("appendOrUpdate");
  });

  it("has Route Back switch", () => {
    expect(hasNodeName(wf, "Scoring: Route Back")).toBe(true);
  });
});

describe("Combined Workflow — Fan-in (3 sources → 1 scorer)", () => {
  it("Research: Parse Results connects to Scoring: Risk Scorer", () => {
    expect(connectsTo(wf, "Research: Parse Results", "Scoring: Risk Scorer")).toBe(true);
  });

  it("Monitor: Enrich & Classify Event connects to Scoring: Risk Scorer", () => {
    expect(connectsTo(wf, "Monitor: Enrich & Classify Event", "Scoring: Risk Scorer")).toBe(true);
  });

  it("AdHoc: Tag Source connects to Scoring: Risk Scorer", () => {
    expect(connectsTo(wf, "AdHoc: Tag Source", "Scoring: Risk Scorer")).toBe(true);
  });
});

describe("Combined Workflow — Route Back (scorer → per-flow continuations)", () => {
  it("Route Back connects to Research: Update Research Dates", () => {
    expect(connectsTo(wf, "Scoring: Route Back", "Research: Update Research Dates")).toBe(true);
  });

  it("Route Back connects to AdHoc: Post Thread Reply", () => {
    expect(connectsTo(wf, "Scoring: Route Back", "AdHoc: Post Thread Reply")).toBe(true);
  });
});
