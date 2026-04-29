// ── Types ──────────────────────────────────────────────────────────────────

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  position: [number, number];
  typeVersion: number;
  parameters: Record<string, unknown>;
  notes?: string;
  credentials?: Record<string, { id: string; name: string }>;
}

export interface N8nConnection {
  node: string;
  type: string;
  index: number;
}

export interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: N8nConnection[][] }>;
  settings: { executionOrder: string };
  tags: string[];
}

// ── Position Helper ────────────────────────────────────────────────────────

let nodeCounter = 0;

export function resetNodeCounter(): void {
  nodeCounter = 0;
}

export function nextId(): string {
  return `node-${++nodeCounter}`;
}

export function pos(col: number, row: number = 0): [number, number] {
  return [col * 240 + 100, row * 200 + 300];
}

// ── Node Builders ──────────────────────────────────────────────────────────

export function createNode(
  name: string,
  type: string,
  position: [number, number],
  parameters: Record<string, unknown>,
  typeVersion: number = 1,
  notes?: string,
): N8nNode {
  return {
    id: nextId(),
    name,
    type: `n8n-nodes-base.${type}`,
    position,
    typeVersion,
    parameters,
    ...(notes ? { notes } : {}),
  };
}

export function scheduleNode(
  name: string,
  hour: number,
  position: [number, number],
): N8nNode {
  return createNode(name, "scheduleTrigger", position, {
    rule: {
      interval: [{ field: "hours", hoursInterval: 24, triggerAtHour: hour }],
    },
  }, 1.2);
}

export function manualTriggerNode(
  name: string,
  position: [number, number],
): N8nNode {
  return createNode(name, "manualTrigger", position, {}, 1);
}

export function httpRequestNode(
  name: string,
  method: string,
  url: string,
  position: [number, number],
  body?: string,
  notes?: string,
): N8nNode {
  const params: Record<string, unknown> = {
    method,
    url,
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendHeaders: true,
    headerParameters: {
      parameters: [{ name: "x-api-key", value: "={{ $vars.PARALLEL_API_KEY }}" }],
    },
  };
  if (body) {
    params.sendBody = true;
    params.specifyBody = "json";
    params.jsonBody = body;
  }
  return createNode(name, "httpRequest", position, params, 4.2, notes);
}

export function codeNode(
  name: string,
  jsCode: string,
  position: [number, number],
): N8nNode {
  return createNode(name, "code", position, { mode: "runOnceForAllItems", jsCode }, 2);
}

export function googleSheetsNode(
  name: string,
  operation: "read" | "append" | "update",
  sheetName: string,
  position: [number, number],
): N8nNode {
  const n8nOp = operation === "read" ? "read"
    : operation === "append" ? "appendOrUpdate"
    : "appendOrUpdate";
  const params: Record<string, unknown> = {
    operation: n8nOp,
    documentId: { __rl: true, mode: "id", value: "={{ $vars.GOOGLE_SHEET_ID }}" },
    sheetName: { __rl: true, mode: "name", value: sheetName },
    options: {},
  };
  if (operation === "append" || operation === "update") {
    params.columns = { mappingMode: "autoMapInputData" };
  }
  return createNode(name, "googleSheets", position, params, 4.5);
}

export function slackNode(
  name: string,
  channel: string,
  position: [number, number],
  textExpr: string = "={{ $json.text }}",
): N8nNode {
  return createNode(name, "slack", position, {
    resource: "message",
    operation: "post",
    channel: { __rl: true, mode: "name", value: channel },
    text: textExpr,
    otherOptions: {},
  }, 2.2);
}

export function webhookNode(
  name: string,
  path: string,
  position: [number, number],
): N8nNode {
  return createNode(name, "webhook", position, {
    path,
    httpMethod: "POST",
    responseMode: "onReceived",
  }, 2);
}

export function waitNode(
  name: string,
  seconds: number,
  position: [number, number],
): N8nNode {
  return createNode(name, "wait", position, {
    amount: seconds,
    unit: "seconds",
  }, 1.1);
}

export function ifNode(
  name: string,
  leftValue: string,
  rightValue: string,
  position: [number, number],
): N8nNode {
  return createNode(name, "if", position, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
      conditions: [{
        leftValue,
        rightValue,
        operator: { type: "string", operation: "equals" },
        id: "condition-0",
      }],
      combinator: "and",
    },
  }, 2);
}

export function splitInBatchesNode(
  name: string,
  batchSize: number,
  position: [number, number],
): N8nNode {
  return createNode(name, "splitInBatches", position, {
    batchSize,
    options: {},
  }, 3);
}

export function switchNode(
  name: string,
  routingField: string,
  routes: string[],
  position: [number, number],
): N8nNode {
  return createNode(name, "switch", position, {
    rules: {
      values: routes.map((value) => ({
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
          conditions: [{
            leftValue: routingField,
            rightValue: value,
            operator: { type: "string", operation: "equals" },
          }],
          combinator: "and",
        },
        renameOutput: true,
        outputKey: value,
      })),
    },
    options: {
      fallbackOutput: "extra",
    },
  }, 3.2);
}

export function executeWorkflowNode(
  name: string,
  position: [number, number],
): N8nNode {
  return createNode(name, "executeWorkflow", position, {
    source: "parameter",
    workflowId: "",
  }, 1);
}

export function executeWorkflowTriggerNode(
  name: string,
  position: [number, number],
): N8nNode {
  return createNode(name, "executeWorkflowTrigger", position, {}, 1);
}

// ── Parallel AI Native Node Builders ──────────────────────────────────────

const PARALLEL_CREDENTIAL = { parallelApi: { id: "", name: "Parallel API" } };

export interface ParallelMonitorOptions {
  query: string;
  cadence: "hourly" | "daily" | "weekly" | "every_two_weeks";
  webhookUrl?: string;
  outputSchemaType?: "text" | "json";
  outputJsonSchema?: string;
  metadata?: Array<{ key: string; value: string }>;
}

export function parallelCreateMonitorNode(
  name: string,
  options: ParallelMonitorOptions | string,
  position: [number, number],
): N8nNode {
  const isExpression = typeof options === "string";
  const params: Record<string, unknown> = {
    resource: "monitor",
    monitorOperation: "createMonitor",
    monitorQuery: isExpression ? options : options.query,
    monitorCadence: isExpression ? "daily" : options.cadence,
  };
  if (!isExpression) {
    if (options.webhookUrl) {
      params.monitorWebhookUrl = options.webhookUrl;
      params.monitorWebhookEventTypes = ["monitor.event.detected"];
    }
    if (options.outputSchemaType === "json" && options.outputJsonSchema) {
      params.monitorOutputSchemaType = "json";
      params.monitorOutputJsonSchema = options.outputJsonSchema;
    }
    if (options.metadata && options.metadata.length > 0) {
      params.monitorAdditionalFields = {
        metadata: { metadataFields: options.metadata },
      };
    }
  }
  return {
    id: nextId(),
    name,
    type: "n8n-nodes-parallel.parallel",
    position,
    typeVersion: 1,
    parameters: params,
    credentials: PARALLEL_CREDENTIAL,
  };
}

export function parallelDeleteMonitorNode(
  name: string,
  monitorIdExpr: string,
  position: [number, number],
): N8nNode {
  return {
    id: nextId(),
    name,
    type: "n8n-nodes-parallel.parallel",
    position,
    typeVersion: 1,
    parameters: {
      resource: "monitor",
      monitorOperation: "deleteMonitor",
      monitorId: monitorIdExpr,
    },
    credentials: PARALLEL_CREDENTIAL,
  };
}

export function parallelGetEventGroupNode(
  name: string,
  monitorIdExpr: string,
  eventGroupIdExpr: string,
  position: [number, number],
): N8nNode {
  return {
    id: nextId(),
    name,
    type: "n8n-nodes-parallel.parallel",
    position,
    typeVersion: 1,
    parameters: {
      resource: "monitor",
      monitorOperation: "getMonitorEventGroup",
      monitorId: monitorIdExpr,
      eventGroupId: eventGroupIdExpr,
    },
    credentials: PARALLEL_CREDENTIAL,
  };
}

export function parallelListMonitorsNode(
  name: string,
  position: [number, number],
): N8nNode {
  return {
    id: nextId(),
    name,
    type: "n8n-nodes-parallel.parallel",
    position,
    typeVersion: 1,
    parameters: {
      resource: "monitor",
      monitorOperation: "listMonitors",
    },
    credentials: PARALLEL_CREDENTIAL,
  };
}

export interface ParallelAsyncEnrichmentOptions {
  inputExpr: string;
  processor?: string;
  outputSchemaType?: "text" | "json" | "auto";
  outputJsonSchema?: string;
  webhookUrl?: string;
}

export function parallelAsyncEnrichmentNode(
  name: string,
  options: ParallelAsyncEnrichmentOptions,
  position: [number, number],
  notes?: string,
): N8nNode {
  const params: Record<string, unknown> = {
    resource: "task",
    operation: "asyncWebEnrichment",
    inputType: "text",
    textInput: options.inputExpr,
    asyncProcessor: options.processor ?? "ultra8x",
  };
  if (options.outputSchemaType === "json" && options.outputJsonSchema) {
    params.asyncOutputSchemaType = "json";
    params.asyncOutputJsonSchema = options.outputJsonSchema;
  } else {
    params.asyncOutputSchemaType = options.outputSchemaType ?? "text";
  }
  if (options.webhookUrl) {
    params.webhookUrl = options.webhookUrl;
  }
  return {
    id: nextId(),
    name,
    type: "n8n-nodes-parallel.parallel",
    position,
    typeVersion: 1,
    parameters: params,
    credentials: PARALLEL_CREDENTIAL,
    ...(notes ? { notes } : {}),
  };
}

export function parallelMonitorTriggerNode(
  name: string,
  position: [number, number],
  fetchEventGroup: boolean = true,
): N8nNode {
  return {
    id: nextId(),
    name,
    type: "n8n-nodes-parallel.parallelMonitorTrigger",
    position,
    typeVersion: 1,
    parameters: {
      eventTypeFilter: ["monitor.event.detected"],
      fetchEventGroup,
      validateSignatures: false,
      includeWebhookData: false,
    },
    credentials: PARALLEL_CREDENTIAL,
  };
}

export function parallelTaskTriggerNode(
  name: string,
  position: [number, number],
): N8nNode {
  return {
    id: nextId(),
    name,
    type: "n8n-nodes-parallel.parallelTrigger",
    position,
    typeVersion: 1,
    parameters: {
      onlyCompleted: true,
      validateSignatures: false,
      includeWebhookData: false,
    },
    credentials: PARALLEL_CREDENTIAL,
  };
}

// ── Connection Builders ────────────────────────────────────────────────────

export function connect(
  fromName: string,
  toName: string,
  fromOutput: number = 0,
): { from: string; to: string; output: number } {
  return { from: fromName, to: toName, output: fromOutput };
}

export function buildConnections(
  pairs: Array<{ from: string; to: string; output: number }>,
): Record<string, { main: N8nConnection[][] }> {
  const conns: Record<string, { main: N8nConnection[][] }> = {};

  for (const { from, to, output } of pairs) {
    if (!conns[from]) {
      conns[from] = { main: [] };
    }
    while (conns[from].main.length <= output) {
      conns[from].main.push([]);
    }
    conns[from].main[output].push({ node: to, type: "main", index: 0 });
  }

  return conns;
}

// ── Workflow Builder ───────────────────────────────────────────────────────

export function buildWorkflow(
  name: string,
  nodes: N8nNode[],
  connections: Record<string, { main: N8nConnection[][] }>,
): N8nWorkflow {
  return {
    name,
    nodes,
    connections,
    settings: { executionOrder: "v1" },
    tags: ["n8n-procurement", "vendor-risk"],
  };
}
