"use client";

import { useEffect, useMemo, useState } from "react";
import { ObserveCanvas } from "@/components/observe/ObserveCanvas";
import { ObserveLeftPanel } from "@/components/observe/ObserveLeftPanel";
import { ObserveTimeline } from "@/components/observe/ObserveTimeline";
import {
  buildObserveFlow,
  createDefaultObserveFilters,
  filterNodesByReplayWindow,
  inferActiveNodeIdsFromReplay,
  selectReplayWindow,
  summarizeNodeCounts,
} from "@/lib/observe-adapters";
import { observeMockSnapshot } from "@/lib/observe-mock-data";
import type { ObserveFilters } from "@/lib/observe-types";
import styles from "@/components/observe/observe-workspace.module.css";

type ObserveControls = {
  enableClustering: boolean;
  autoLayout: boolean;
};

export function ObserveWorkspace() {
  const [filters, setFilters] = useState<ObserveFilters>(createDefaultObserveFilters);
  const [controls, setControls] = useState<ObserveControls>({
    enableClustering: true,
    autoLayout: true,
  });
  const [mode, setMode] = useState<"snapshot" | "replay">("replay");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadIndex, setPlayheadIndex] = useState(observeMockSnapshot.timeline.length - 1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const replayEnabled = mode === "replay";

  const replayEvents = useMemo(
    () => selectReplayWindow(observeMockSnapshot.timeline, replayEnabled ? playheadIndex : observeMockSnapshot.timeline.length - 1),
    [playheadIndex, replayEnabled],
  );

  const replayNodeIds = useMemo(() => inferActiveNodeIdsFromReplay(replayEvents), [replayEvents]);
  const replayScopedSnapshot = useMemo(
    () => ({
      ...observeMockSnapshot,
      nodes: replayEnabled
        ? filterNodesByReplayWindow(observeMockSnapshot.nodes, replayNodeIds)
        : observeMockSnapshot.nodes,
    }),
    [replayEnabled, replayNodeIds],
  );

  const flow = useMemo(
    () =>
      buildObserveFlow({
        snapshot: replayScopedSnapshot,
        filters,
        enableClustering: controls.enableClustering,
      }),
    [replayScopedSnapshot, filters, controls.enableClustering],
  );

  const selectedNode = useMemo(
    () => replayScopedSnapshot.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [replayScopedSnapshot.nodes, selectedNodeId],
  );

  const counts = useMemo(() => summarizeNodeCounts(replayScopedSnapshot.nodes), [replayScopedSnapshot.nodes]);

  const toggleControl = (name: keyof ObserveControls) =>
    setControls((current) => ({
      ...current,
      [name]: !current[name],
    }));

  useEffect(() => {
    if (!replayEnabled || !isPlaying) return;
    const id = window.setInterval(() => {
      setPlayheadIndex((current) => {
        if (current >= observeMockSnapshot.timeline.length - 1) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 900);
    return () => window.clearInterval(id);
  }, [isPlaying, replayEnabled]);

  return (
    <div className={styles.observeWorkspace}>
      <div className={styles.observeTopStats}>
        <section className="surface-panel">
          <div className="eyebrow">Topology size</div>
          <strong>{replayScopedSnapshot.nodes.length} nodes</strong>
          <p>{replayScopedSnapshot.edges.length} edges in current scope</p>
        </section>
        <section className="surface-panel">
          <div className="eyebrow">Active states</div>
          <strong>{counts.byState.get("active") ?? 0} active</strong>
          <p>{counts.byState.get("triggered") ?? 0} triggered, {counts.byState.get("spawning") ?? 0} spawning</p>
        </section>
        <section className="surface-panel">
          <div className="eyebrow">Node types</div>
          <strong>{counts.byType.get("monitor") ?? 0} monitors</strong>
          <p>{counts.byType.get("deep_research") ?? 0} deep research, {counts.byType.get("search") ?? 0} searches</p>
        </section>
        <section className="surface-panel">
          <div className="eyebrow">Mode</div>
          <div className={styles.modeSwitch}>
            <button
              type="button"
              className={mode === "snapshot" ? styles.modeButtonActive : styles.modeButton}
              onClick={() => {
                setMode("snapshot");
                setIsPlaying(false);
              }}
            >
              Snapshot
            </button>
            <button
              type="button"
              className={mode === "replay" ? styles.modeButtonActive : styles.modeButton}
              onClick={() => setMode("replay")}
            >
              Replay
            </button>
          </div>
          <p>{mode === "replay" ? "Chronology scrub and playback enabled." : "Full topology snapshot view."}</p>
        </section>
      </div>

      <div className={styles.observeMainGrid}>
        <ObserveLeftPanel
          snapshot={observeMockSnapshot}
          filters={filters}
          controls={controls}
          mode={mode}
          isPlaying={isPlaying}
          onTogglePlaying={() => setIsPlaying((current) => !current)}
          onModeChange={(nextMode) => {
            setMode(nextMode);
            if (nextMode === "snapshot") setIsPlaying(false);
          }}
          onSetMaxDepth={(value) => setFilters((current) => ({ ...current, maxDepth: value }))}
          onToggleHideCompleted={() => setFilters((current) => ({ ...current, hideCompleted: !current.hideCompleted }))}
          onToggleControl={toggleControl}
        />
        <ObserveCanvas
          flowNodes={flow.nodes}
          flowEdges={flow.edges}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
        />
      </div>

      <ObserveTimeline
        events={observeMockSnapshot.timeline}
        mode={mode}
        isPlaying={isPlaying}
        onTogglePlaying={() => setIsPlaying((current) => !current)}
        playheadIndex={playheadIndex}
        onPlayheadChange={setPlayheadIndex}
        onStep={(direction) =>
          setPlayheadIndex((current) =>
            Math.max(0, Math.min(observeMockSnapshot.timeline.length - 1, current + direction)),
          )
        }
      />
    </div>
  );
}
