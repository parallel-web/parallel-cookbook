"use client";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import { ObserveNode } from "@/components/observe/ObserveNode";
import { buildEventBatcher, isFlowLarge } from "@/lib/observe-adapters";
import type { ObserveFlowEdge, ObserveFlowNode } from "@/lib/observe-types";
import styles from "@/components/observe/observe-workspace.module.css";
import "@xyflow/react/dist/style.css";

function ObserveCanvasInner({
  flowNodes,
  flowEdges,
  selectedNodeId,
  onSelectNode,
}: {
  flowNodes: ObserveFlowNode[];
  flowEdges: ObserveFlowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);
  const largeFlow = isFlowLarge(flowNodes, flowEdges);

  useEffect(() => {
    const applyNodeBatch = buildEventBatcher<ObserveFlowNode[]>((batches) => {
      const latest = batches[batches.length - 1];
      if (latest) setNodes(latest);
    });
    applyNodeBatch(flowNodes);
  }, [flowNodes, setNodes]);

  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  const nodeTypes = useMemo(() => ({ observeNode: ObserveNode }), []);

  const onSelectionChange = (params: OnSelectionChangeParams) => {
    const selected = params.nodes[0];
    onSelectNode(selected?.id ?? null);
  };

  return (
    <div className={styles.canvasWrap}>
      <ReactFlow
        nodes={nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId }))}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} size={1} />
        <MiniMap pannable zoomable />
        <Controls position="bottom-right" />
      </ReactFlow>
      {largeFlow ? (
        <div className={styles.performanceBanner}>
          Large topology mode active: completed nodes are clustered and animation intensity is reduced.
        </div>
      ) : null}
    </div>
  );
}

export function ObserveCanvas(props: {
  flowNodes: ObserveFlowNode[];
  flowEdges: ObserveFlowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}) {
  return (
    <ReactFlowProvider>
      <ObserveCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
