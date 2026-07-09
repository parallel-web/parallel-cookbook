import type { Edge, Node } from "@xyflow/react";

export type ObserveNodeType = "campaign" | "monitor" | "search" | "deep_research" | "enrichment" | "find_all" | "cluster";

export type ObserveNodeState =
  | "spawning"
  | "active"
  | "triggered"
  | "complete"
  | "failed"
  | "paused"
  | "budget_blocked";

export type ObserveEdgeRelation = "seeded" | "spawned" | "investigated" | "enriched" | "discovered";

export type ObserveSource = "deep_research" | "monitor_event" | "adhoc";

export interface ObserveCitation {
  title: string;
  url: string;
  confidence: number;
  excerpt?: string;
}

export interface ObserveLifecycleTransition {
  state: ObserveNodeState;
  changedAt: string;
  reason: string;
}

export interface ObserveNodeCost {
  actualUsd: number;
  estimatedTotalUsd: number;
  remainingBudgetUsd: number;
}

export interface ObserveSpawnReference {
  id: string;
  type: ObserveNodeType;
  reason: string;
}

export interface ObserveNodeProvenance {
  source: ObserveSource;
  runId?: string;
  taskGroupId?: string;
  monitorId?: string;
  eventGroupId?: string;
  signalStrength?: number;
  threshold?: number;
  citations: ObserveCitation[];
}

export interface ObserveRulesEvaluation {
  signalStrength: number;
  threshold: number;
  budgetGate: "pass" | "queued" | "blocked";
  deduplication: "pass" | "blocked";
  rateLimit: "pass" | "blocked";
  depthLimit: "pass" | "blocked";
  scopeCheck: "pass" | "blocked";
  decision: "allowed" | "queued" | "blocked";
  decisionReason: string;
}

export interface ObserveTimelineEvent {
  id: string;
  happenedAt: string;
  nodeId: string;
  nodeType: ObserveNodeType;
  state: ObserveNodeState;
  summary: string;
}

export interface ObserveTransportPhase {
  id: "snapshot" | "replay" | "live";
  title: string;
  status: "available" | "partial" | "planned";
  details: string;
}

export interface ObserveNodeData extends Record<string, unknown> {
  id: string;
  type: ObserveNodeType;
  state: ObserveNodeState;
  title: string;
  subtitle: string;
  campaignId: string;
  vendorId?: string;
  parentId?: string;
  childIds: string[];
  whyThisNodeExists: string;
  whatItIsDoing: string;
  spawnedBy?: ObserveSpawnReference;
  spawnedAt: string;
  spawnedChildren: ObserveSpawnReference[];
  cost: ObserveNodeCost;
  lifecycle: {
    currentState: ObserveNodeState;
    lastTransitionAt: string;
    transitions: ObserveLifecycleTransition[];
  };
  provenance: ObserveNodeProvenance;
  rulesEvaluation: ObserveRulesEvaluation;
}

export interface ObserveEdgeData extends Record<string, unknown> {
  relation: ObserveEdgeRelation;
  reasonSummary: string;
  createdAt: string;
  confidence?: number;
}

export interface ObserveGraphSnapshot {
  campaignId: string;
  campaignName: string;
  generatedAt: string;
  budget: {
    totalUsd: number;
    spentUsd: number;
    remainingUsd: number;
  };
  nodes: ObserveNodeData[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relation: ObserveEdgeRelation;
    reasonSummary: string;
    createdAt: string;
    confidence?: number;
  }>;
  timeline: ObserveTimelineEvent[];
  transportPhases: ObserveTransportPhase[];
}

export interface ObserveFilters {
  nodeTypes: ObserveNodeType[];
  nodeStates: ObserveNodeState[];
  maxDepth: number;
  hideCompleted: boolean;
}

export type ObserveFlowNode = Node<ObserveNodeData>;
export type ObserveFlowEdge = Edge<ObserveEdgeData>;
