import type { EdgeMarker, NodePositionChange } from "@xyflow/react";
import type {
  ObserveEdgeData,
  ObserveFilters,
  ObserveFlowEdge,
  ObserveFlowNode,
  ObserveGraphSnapshot,
  ObserveNodeData,
  ObserveNodeType,
  ObserveTimelineEvent,
} from "@/lib/observe-types";

const NODE_HORIZONTAL_GAP = 320;
const NODE_VERTICAL_GAP = 160;
const CLUSTER_NODE_ID = "cluster-completed";

function getDepthByNodeId(snapshot: ObserveGraphSnapshot) {
  const depthMap = new Map<string, number>();
  const rootNode = snapshot.nodes.find((node) => node.type === "campaign") ?? snapshot.nodes[0];
  if (!rootNode) return depthMap;

  const queue: Array<{ id: string; depth: number }> = [{ id: rootNode.id, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    depthMap.set(current.id, current.depth);

    snapshot.edges
      .filter((edge) => edge.source === current.id)
      .forEach((edge) => queue.push({ id: edge.target, depth: current.depth + 1 }));
  }

  snapshot.nodes.forEach((node) => {
    if (!depthMap.has(node.id)) depthMap.set(node.id, 0);
  });

  return depthMap;
}

function positionNodesByDepth(snapshot: ObserveGraphSnapshot, visibleNodes: ObserveNodeData[]) {
  const depthMap = getDepthByNodeId(snapshot);
  const rowsByDepth = new Map<number, ObserveNodeData[]>();

  visibleNodes.forEach((node) => {
    const depth = depthMap.get(node.id) ?? 0;
    const rows = rowsByDepth.get(depth) ?? [];
    rows.push(node);
    rowsByDepth.set(depth, rows);
  });

  const positions = new Map<string, { x: number; y: number }>();
  Array.from(rowsByDepth.entries()).forEach(([depth, nodes]) => {
    nodes
      .sort((left, right) => left.spawnedAt.localeCompare(right.spawnedAt))
      .forEach((node, index) => {
        positions.set(node.id, {
          x: depth * NODE_HORIZONTAL_GAP,
          y: index * NODE_VERTICAL_GAP,
        });
      });
  });

  return positions;
}

function markerForRelation(): EdgeMarker {
  return { type: "arrowclosed", width: 18, height: 18 };
}

function shouldKeepNode(node: ObserveNodeData, filters: ObserveFilters, depthMap: Map<string, number>) {
  if (!filters.nodeTypes.includes(node.type)) return false;
  if (!filters.nodeStates.includes(node.state)) return false;
  if (filters.hideCompleted && node.state === "complete") return false;
  if ((depthMap.get(node.id) ?? 0) > filters.maxDepth) return false;
  return true;
}

function clusterCompletedNodes(
  nodes: ObserveNodeData[],
  edges: ObserveGraphSnapshot["edges"],
  enableClustering: boolean,
  threshold: number,
) {
  if (!enableClustering || nodes.length <= threshold) {
    return { nodes, edges };
  }

  const completeNodes = nodes.filter((node) => node.state === "complete");
  if (completeNodes.length < 20) {
    return { nodes, edges };
  }

  const clusteredIds = new Set(completeNodes.map((node) => node.id));
  const clusteredNode: ObserveNodeData = {
    id: CLUSTER_NODE_ID,
    type: "cluster",
    state: "complete",
    title: `${completeNodes.length} completed nodes`,
    subtitle: "Collapsed for performance",
    campaignId: nodes[0]?.campaignId ?? "campaign",
    childIds: completeNodes.map((node) => node.id),
    whyThisNodeExists: "Completed nodes are auto-collapsed to preserve canvas readability and frame-rate.",
    whatItIsDoing: "Summarizing low-activity completed branches.",
    spawnedAt: completeNodes[0]?.spawnedAt ?? new Date().toISOString(),
    spawnedChildren: [],
    cost: {
      actualUsd: completeNodes.reduce((sum, node) => sum + node.cost.actualUsd, 0),
      estimatedTotalUsd: completeNodes.reduce((sum, node) => sum + node.cost.estimatedTotalUsd, 0),
      remainingBudgetUsd: completeNodes[0]?.cost.remainingBudgetUsd ?? 0,
    },
    lifecycle: {
      currentState: "complete",
      lastTransitionAt: new Date().toISOString(),
      transitions: [
        {
          state: "complete",
          changedAt: new Date().toISOString(),
          reason: "Auto-clustered completed nodes for performance.",
        },
      ],
    },
    provenance: {
      source: "adhoc",
      citations: [],
    },
    rulesEvaluation: {
      signalStrength: 1,
      threshold: 0.7,
      budgetGate: "pass",
      deduplication: "pass",
      rateLimit: "pass",
      depthLimit: "pass",
      scopeCheck: "pass",
      decision: "allowed",
      decisionReason: "Visualization layer performance optimization.",
    },
  };

  const nodesWithoutClustered = nodes.filter((node) => !clusteredIds.has(node.id));
  const clusterEdges: ObserveGraphSnapshot["edges"] = [];
  const nextEdges = edges
    .filter((edge) => !clusteredIds.has(edge.source) || !clusteredIds.has(edge.target))
    .map((edge) => {
      if (clusteredIds.has(edge.source) && !clusteredIds.has(edge.target)) {
        const clusterEdgeId = `${CLUSTER_NODE_ID}->${edge.target}`;
        if (!clusterEdges.find((candidate) => candidate.id === clusterEdgeId)) {
          clusterEdges.push({
            id: clusterEdgeId,
            source: CLUSTER_NODE_ID,
            target: edge.target,
            relation: "spawned",
            reasonSummary: "Collapsed completed branch",
            createdAt: edge.createdAt,
            confidence: edge.confidence,
          });
        }
      }

      if (!clusteredIds.has(edge.source) && clusteredIds.has(edge.target)) {
        const clusterEdgeId = `${edge.source}->${CLUSTER_NODE_ID}`;
        if (!clusterEdges.find((candidate) => candidate.id === clusterEdgeId)) {
          clusterEdges.push({
            id: clusterEdgeId,
            source: edge.source,
            target: CLUSTER_NODE_ID,
            relation: "spawned",
            reasonSummary: "Collapsed completed branch",
            createdAt: edge.createdAt,
            confidence: edge.confidence,
          });
        }
      }

      return edge;
    });

  return {
    nodes: [...nodesWithoutClustered, clusteredNode],
    edges: [...nextEdges.filter((edge) => !clusteredIds.has(edge.source) && !clusteredIds.has(edge.target)), ...clusterEdges],
  };
}

export function createDefaultObserveFilters(): ObserveFilters {
  return {
    nodeTypes: ["campaign", "monitor", "search", "deep_research", "enrichment", "find_all", "cluster"],
    nodeStates: ["spawning", "active", "triggered", "complete", "failed", "paused", "budget_blocked"],
    maxDepth: 10,
    hideCompleted: false,
  };
}

export function buildObserveFlow({
  snapshot,
  filters,
  enableClustering,
  clusterThreshold = 1000,
}: {
  snapshot: ObserveGraphSnapshot;
  filters: ObserveFilters;
  enableClustering: boolean;
  clusterThreshold?: number;
}) {
  const depthMap = getDepthByNodeId(snapshot);
  const visibleNodes = snapshot.nodes.filter((node) => shouldKeepNode(node, filters, depthMap));
  const clustered = clusterCompletedNodes(visibleNodes, snapshot.edges, enableClustering, clusterThreshold);
  const visibleNodeIds = new Set(clustered.nodes.map((node) => node.id));
  const positionedNodes = positionNodesByDepth(snapshot, clustered.nodes);

  const nodes: ObserveFlowNode[] = clustered.nodes.map((node) => ({
    id: node.id,
    type: "observeNode",
    data: node,
    position: positionedNodes.get(node.id) ?? { x: 0, y: 0 },
    draggable: true,
  }));

  const edges: ObserveFlowEdge[] = clustered.edges
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      markerEnd: markerForRelation(),
      animated: edge.relation === "spawned",
      label: `${edge.relation}: ${edge.reasonSummary}`,
      data: {
        relation: edge.relation,
        reasonSummary: edge.reasonSummary,
        createdAt: edge.createdAt,
        confidence: edge.confidence,
      } satisfies ObserveEdgeData,
      labelStyle: { fontSize: 10 },
    }));

  return { nodes, edges };
}

export function selectReplayWindow(events: ObserveTimelineEvent[], playheadIndex: number) {
  if (playheadIndex < 0) return [];
  return events.slice(0, Math.min(playheadIndex + 1, events.length));
}

export function inferActiveNodeIdsFromReplay(events: ObserveTimelineEvent[]) {
  return new Set(events.map((event) => event.nodeId));
}

export function filterNodesByReplayWindow(nodes: ObserveNodeData[], replayNodeIds: Set<string>) {
  return nodes.filter((node) => replayNodeIds.has(node.id) || node.type === "campaign");
}

export function buildEventBatcher<T>(applyBatch: (items: T[]) => void) {
  let queue: T[] = [];
  let raf: number | null = null;

  return (item: T) => {
    queue.push(item);
    if (raf !== null) return;
    raf = window.requestAnimationFrame(() => {
      applyBatch(queue);
      queue = [];
      raf = null;
    });
  };
}

export function isFlowLarge(nodes: ObserveFlowNode[], edges: ObserveFlowEdge[]) {
  return nodes.length > 1000 || edges.length > 2000;
}

export function summarizeNodeCounts(nodes: ObserveNodeData[]) {
  const byType = new Map<ObserveNodeType, number>();
  const byState = new Map<ObserveNodeData["state"], number>();

  nodes.forEach((node) => {
    byType.set(node.type, (byType.get(node.type) ?? 0) + 1);
    byState.set(node.state, (byState.get(node.state) ?? 0) + 1);
  });

  return { byType, byState };
}

export function nodePositionChangeLookup(changes: NodePositionChange[]) {
  return new Set(changes.map((change) => change.id));
}
