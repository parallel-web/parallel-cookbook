"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/components/dashboard-ui";
import type { ObserveFlowNode, ObserveNodeType } from "@/lib/observe-types";
import styles from "@/components/observe/observe-workspace.module.css";

const typeIcon: Record<ObserveNodeType, string> = {
  campaign: "◉",
  monitor: "◎",
  search: "⊕",
  deep_research: "◈",
  enrichment: "⬡",
  find_all: "⊞",
  cluster: "◌",
};

function stateLabel(state: ObserveFlowNode["data"]["state"]) {
  return state.replaceAll("_", " ");
}

export function ObserveNode({ data, selected }: NodeProps<ObserveFlowNode>) {
  const progressRatio = Math.max(0.05, Math.min(data.cost.actualUsd / Math.max(data.cost.estimatedTotalUsd, 0.01), 1));
  const ring = `${Math.round(progressRatio * 100)}%`;

  return (
    <div
      className={cn(
        styles.observeNode,
        styles[`nodeType_${data.type}`],
        styles[`nodeState_${data.state}`],
        selected && styles.nodeSelected,
      )}
      aria-label={`${data.title} ${stateLabel(data.state)}`}
    >
      <Handle type="target" position={Position.Left} className={styles.nodeHandle} />
      <div className={styles.nodeTopRow}>
        <span className={styles.nodeIcon} aria-hidden="true">
          {typeIcon[data.type]}
        </span>
        <span className={styles.nodeStatePill}>{stateLabel(data.state)}</span>
      </div>
      <strong>{data.title}</strong>
      <p>{data.subtitle}</p>
      <div className={styles.nodeMeta}>
        <span>{data.provenance.source}</span>
        <span>{data.spawnedChildren.length} spawned</span>
        <span>${data.cost.actualUsd.toFixed(2)}</span>
      </div>
      <div className={styles.nodeRing} aria-hidden="true">
        <div className={styles.nodeRingFill} style={{ width: ring }} />
      </div>
      <Handle type="source" position={Position.Right} className={styles.nodeHandle} />
    </div>
  );
}
