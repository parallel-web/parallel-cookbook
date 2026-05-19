import { describe, it, expect } from "vitest";
import { generateVendorSyncWorkflow } from "@/workflows/generators/workflow1-vendor-sync.js";
import { generateDeepResearchWorkflow } from "@/workflows/generators/workflow2-deep-research.js";
import { generateRiskScoringWorkflow } from "@/workflows/generators/workflow3-risk-scoring.js";
import { generateMonitorWorkflow } from "@/workflows/generators/workflow4-monitors.js";
import { generateAdHocWorkflow } from "@/workflows/generators/workflow5-adhoc.js";
import type { N8nWorkflow } from "@/workflows/generator-utils.js";

// ── Shared Validator ───────────────────────────────────────────────────────

function validateWorkflow(wf: N8nWorkflow) {
  expect(typeof wf.name).toBe("string");
  expect(wf.name.length).toBeGreaterThan(0);
  expect(Array.isArray(wf.nodes)).toBe(true);
  expect(wf.nodes.length).toBeGreaterThan(0);
  expect(typeof wf.connections).toBe("object");
  expect(wf.settings).toBeDefined();

  // Validate each node
  const nodeNames = new Set<string>();
  for (const node of wf.nodes) {
    expect(typeof node.id).toBe("string");
    expect(typeof node.name).toBe("string");
    expect(typeof node.type).toBe("string");
    expect(node.type).toMatch(/^n8n-nodes-base\./);
    expect(Array.isArray(node.position)).toBe(true);
    expect(node.position).toHaveLength(2);
    expect(typeof node.position[0]).toBe("number");
    expect(typeof node.position[1]).toBe("number");
    expect(typeof node.typeVersion).toBe("number");
    expect(typeof node.parameters).toBe("object");

    // No duplicate names
    expect(nodeNames.has(node.name)).toBe(false);
    nodeNames.add(node.name);
  }

  // Validate connections reference existing nodes
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

function hasNodeType(wf: N8nWorkflow, type: string): boolean {
  return wf.nodes.some((n) => n.type === `n8n-nodes-base.${type}`);
}

function hasNodeName(wf: N8nWorkflow, name: string): boolean {
  return wf.nodes.some((n) => n.name === name);
}

// ── Workflow 1: Vendor Sync ────────────────────────────────────────────────

describe("Workflow 1: Vendor Sync", () => {
  const wf = generateVendorSyncWorkflow();

  it("generates valid n8n workflow structure", () => {
    validateWorkflow(wf);
  });

  it("has correct name", () => {
    expect(wf.name).toContain("Vendor");
    expect(wf.name).toContain("Sync");
  });

  it("has Schedule Trigger", () => {
    expect(hasNodeType(wf, "scheduleTrigger")).toBe(true);
  });

  it("has Google Sheets read node", () => {
    expect(hasNodeType(wf, "googleSheets")).toBe(true);
  });

  it("has Code node for diff", () => {
    expect(hasNodeName(wf, "Compute Diff")).toBe(true);
  });

  it("has an SDK Code node for monitor creation", () => {
    const createNode = wf.nodes.find((n) => n.name === "Create Monitor");
    expect(createNode).toBeDefined();
    expect(createNode!.type).toBe("n8n-nodes-base.code");
    const code = String((createNode!.parameters as { jsCode?: string }).jsCode ?? "");
    expect(code).toContain("require('parallel-web')");
    expect(code).toContain("client.monitor.create");
  });

  it("has an SDK Code node for monitor cancellation (V1)", () => {
    const cancelNode = wf.nodes.find((n) => n.name === "Cancel Monitor");
    expect(cancelNode).toBeDefined();
    expect(cancelNode!.type).toBe("n8n-nodes-base.code");
    const code = String((cancelNode!.parameters as { jsCode?: string }).jsCode ?? "");
    expect(code).toContain("client.monitor.cancel");
  });
});

// ── Workflow 2: Deep Research ──────────────────────────────────────────────

describe("Workflow 2: Deep Research", () => {
  const wf = generateDeepResearchWorkflow();

  it("generates valid n8n workflow structure", () => {
    validateWorkflow(wf);
  });

  it("has Schedule Trigger at 6 AM", () => {
    expect(hasNodeType(wf, "scheduleTrigger")).toBe(true);
  });

  it("uses an SDK Code node to drive the task group lifecycle", () => {
    const node = wf.nodes.find((n) => n.name === "Run Task Group");
    expect(node).toBeDefined();
    expect(node!.type).toBe("n8n-nodes-base.code");
    const code = String((node!.parameters as { jsCode?: string }).jsCode ?? "");
    expect(code).toContain("client.taskGroup.create");
    expect(code).toContain("client.taskGroup.addRuns");
    expect(code).toContain("client.taskGroup.getRuns");
  });

  it("batches at 50 vendors per call", () => {
    const node = wf.nodes.find((n) => n.name === "Run Task Group");
    const code = String((node!.parameters as { jsCode?: string }).jsCode ?? "");
    expect(code).toContain("BATCH = 50");
  });

  it("Parse Results forwards basis to scoring", () => {
    const node = wf.nodes.find((n) => n.name === "Parse Results");
    const code = String((node!.parameters as { jsCode?: string }).jsCode ?? "");
    expect(code).toContain("basis");
    expect(code).toContain("'deep_research'");
  });

  it("has Execute Workflow for scoring", () => {
    expect(hasNodeType(wf, "executeWorkflow")).toBe(true);
  });
});

// ── Workflow 3: Risk Scoring ───────────────────────────────────────────────

describe("Workflow 3: Risk Scoring", () => {
  const wf = generateRiskScoringWorkflow();

  it("generates valid n8n workflow structure", () => {
    validateWorkflow(wf);
  });

  it("has Code node with scoring logic", () => {
    const scorer = wf.nodes.find((n) => n.name === "Risk Scorer");
    expect(scorer).toBeDefined();
    const code = String(scorer!.parameters.jsCode);
    expect(code).toContain("CRITICAL");
    expect(code).toContain("severity");
    expect(code).toContain("override");
  });

  it("has Switch node for routing", () => {
    expect(hasNodeType(wf, "switch")).toBe(true);
  });

  it("has at least 2 Slack nodes", () => {
    const slackNodes = wf.nodes.filter((n) => n.type === "n8n-nodes-base.slack");
    expect(slackNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("has Google Sheets append for audit log", () => {
    const sheetsNode = wf.nodes.find((n) => n.name === "Audit Log");
    expect(sheetsNode).toBeDefined();
    expect(sheetsNode!.parameters.operation).toBe("appendOrUpdate");
  });
});

// ── Workflow 4: Monitors ───────────────────────────────────────────────────

describe("Workflow 4: Monitors", () => {
  const wf = generateMonitorWorkflow();

  it("generates valid n8n workflow structure", () => {
    validateWorkflow(wf);
  });

  it("has Webhook Trigger for events", () => {
    expect(hasNodeType(wf, "webhook")).toBe(true);
    const webhook = wf.nodes.find(
      (n) => n.type === "n8n-nodes-base.webhook" && String(n.parameters.path).includes("monitor-events"),
    );
    expect(webhook).toBeDefined();
  });

  it("uses an SDK Code node for monitor creation", () => {
    const createMon = wf.nodes.find((n) => n.name === "Create Monitor");
    expect(createMon).toBeDefined();
    expect(createMon!.type).toBe("n8n-nodes-base.code");
    const code = String((createMon!.parameters as { jsCode?: string }).jsCode ?? "");
    expect(code).toContain("client.monitor.create");
  });

  it("uses client.monitor.events to fetch event details", () => {
    const fetchNode = wf.nodes.find((n) => n.name === "Fetch Event Details");
    expect(fetchNode).toBeDefined();
    expect(fetchNode!.type).toBe("n8n-nodes-base.code");
    const code = String((fetchNode!.parameters as { jsCode?: string }).jsCode ?? "");
    expect(code).toContain("client.monitor.events");
    expect(code).toContain("event_group_id");
  });

  it("has Execute Workflow for scoring events", () => {
    expect(hasNodeType(wf, "executeWorkflow")).toBe(true);
  });

  it("has Execute Workflow Trigger for deploy sub-flow", () => {
    expect(hasNodeType(wf, "executeWorkflowTrigger")).toBe(true);
  });
});

// ── Workflow 5: Ad-Hoc ─────────────────────────────────────────────────────

describe("Workflow 5: Ad-Hoc", () => {
  const wf = generateAdHocWorkflow();

  it("generates valid n8n workflow structure", () => {
    validateWorkflow(wf);
  });

  it("has 2 Webhook Triggers", () => {
    const webhooks = wf.nodes.filter((n) => n.type === "n8n-nodes-base.webhook");
    expect(webhooks.length).toBe(2);
  });

  it("has slash command webhook", () => {
    const cmd = wf.nodes.find(
      (n) => n.type === "n8n-nodes-base.webhook" && String(n.parameters.path).includes("slack-command"),
    );
    expect(cmd).toBeDefined();
  });

  it("has result callback webhook", () => {
    const cb = wf.nodes.find(
      (n) => n.type === "n8n-nodes-base.webhook" && String(n.parameters.path).includes("adhoc-result"),
    );
    expect(cb).toBeDefined();
  });

  it("has Slack node for acknowledgment", () => {
    expect(hasNodeType(wf, "slack")).toBe(true);
  });

  it("uses client.taskRun.create for the deep research kickoff", () => {
    const taskNode = wf.nodes.find((n) => n.name === "Start Research Task");
    expect(taskNode).toBeDefined();
    expect(taskNode!.type).toBe("n8n-nodes-base.code");
    const code = String((taskNode!.parameters as { jsCode?: string }).jsCode ?? "");
    expect(code).toContain("client.taskRun.create");
  });

  it("uses client.taskRun.result on the callback", () => {
    const resultNode = wf.nodes.find((n) => n.name === "Get Research Result");
    expect(resultNode).toBeDefined();
    expect(resultNode!.type).toBe("n8n-nodes-base.code");
    const code = String((resultNode!.parameters as { jsCode?: string }).jsCode ?? "");
    expect(code).toContain("client.taskRun.result");
  });
});
