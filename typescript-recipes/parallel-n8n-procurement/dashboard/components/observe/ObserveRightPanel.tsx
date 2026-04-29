"use client";

import Link from "next/link";
import type { ObserveGraphSnapshot, ObserveNodeData } from "@/lib/observe-types";
import styles from "@/components/observe/observe-workspace.module.css";

function fmt(value: string) {
  return new Date(value).toLocaleString("en-US", { hour12: true });
}

export function ObserveRightPanel({
  selectedNode,
  snapshot,
}: {
  selectedNode: ObserveNodeData | null;
  snapshot: ObserveGraphSnapshot;
}) {
  return (
    <aside className={styles.rightPanel}>
      <section className="surface-panel">
        <div className="eyebrow">Node narrative</div>
        {selectedNode ? (
          <div className={styles.narrativeStack}>
            <h2 className={styles.panelHeading}>{selectedNode.title}</h2>
            <p className={styles.panelBody}>{selectedNode.whyThisNodeExists}</p>
            <p className={styles.panelBody}>
              <strong>What it is doing:</strong> {selectedNode.whatItIsDoing}
            </p>
            <p className={styles.panelBody}>
              <strong>Spawned at:</strong> {fmt(selectedNode.spawnedAt)}
            </p>
            <p className={styles.panelBody}>
              <strong>Cost:</strong> ${selectedNode.cost.actualUsd.toFixed(2)} actual / $
              {selectedNode.cost.estimatedTotalUsd.toFixed(2)} estimated
            </p>
            <div className={styles.detailList}>
              <strong>Spawn lineage</strong>
              {selectedNode.spawnedBy ? (
                <span>
                  Parent: <code>{selectedNode.spawnedBy.id}</code> ({selectedNode.spawnedBy.type})
                </span>
              ) : (
                <span>Root node</span>
              )}
              <span>Children: {selectedNode.spawnedChildren.length}</span>
            </div>
            <div className={styles.detailList}>
              <strong>Rules decision</strong>
              <span>{selectedNode.rulesEvaluation.decision.toUpperCase()}</span>
              <span>{selectedNode.rulesEvaluation.decisionReason}</span>
            </div>
            <div className={styles.detailList}>
              <strong>Lifecycle transitions</strong>
              {selectedNode.lifecycle.transitions.map((transition) => (
                <span key={`${transition.state}-${transition.changedAt}`}>
                  {transition.state.replaceAll("_", " ")} at {fmt(transition.changedAt)}
                </span>
              ))}
            </div>
            <div className={styles.detailList}>
              <strong>Citations</strong>
              {selectedNode.provenance.citations.length ? (
                selectedNode.provenance.citations.map((citation) => (
                  <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer" className="text-link">
                    {citation.title}
                  </a>
                ))
              ) : (
                <span>No citations attached.</span>
              )}
            </div>
          </div>
        ) : (
          <p className={styles.panelBody}>Select a node in the canvas to inspect its full chain-of-thought narrative.</p>
        )}
      </section>

      <section className="surface-panel">
        <div className="eyebrow">Live integration path</div>
        <div className={styles.transportStack}>
          {snapshot.transportPhases.map((phase) => (
            <div key={phase.id} className={styles.transportRow}>
              <div>
                <strong>{phase.title}</strong>
                <p>{phase.details}</p>
              </div>
              <span className={styles.transportStatus}>{phase.status}</span>
            </div>
          ))}
        </div>
        <div className={styles.detailList}>
          <strong>Planned hooks</strong>
          <span>Snapshot adapter: workflow export + audit log checkpoints</span>
          <span>Replay adapter: monotonic event sequencing by timestamp</span>
          <span>Live transport: SSE/WebSocket with reconnect + catchup cursor</span>
          <Link href="/feed" className="text-link">
            Back to feed context
          </Link>
        </div>
      </section>
    </aside>
  );
}
