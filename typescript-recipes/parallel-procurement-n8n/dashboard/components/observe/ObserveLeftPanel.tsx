"use client";

import type { ObserveFilters, ObserveGraphSnapshot } from "@/lib/observe-types";
import styles from "@/components/observe/observe-workspace.module.css";

type ObserveControls = {
  enableClustering: boolean;
  autoLayout: boolean;
};

export function ObserveLeftPanel({
  snapshot,
  filters,
  controls,
  mode,
  isPlaying,
  onModeChange,
  onTogglePlaying,
  onSetMaxDepth,
  onToggleHideCompleted,
  onToggleControl,
}: {
  snapshot: ObserveGraphSnapshot;
  filters: ObserveFilters;
  controls: ObserveControls;
  mode: "snapshot" | "replay";
  isPlaying: boolean;
  onModeChange: (mode: "snapshot" | "replay") => void;
  onTogglePlaying: () => void;
  onSetMaxDepth: (value: number) => void;
  onToggleHideCompleted: () => void;
  onToggleControl: (name: keyof ObserveControls) => void;
}) {
  return (
    <aside className={styles.leftPanel}>
      <section className="surface-panel">
        <div className="eyebrow">Compact controls</div>
        <h2 className={styles.panelHeading}>{snapshot.campaignName}</h2>
        <p className={styles.panelBody}>
          Budget ${snapshot.budget.totalUsd.toFixed(2)} | Spent ${snapshot.budget.spentUsd.toFixed(2)} | Remaining $
          {snapshot.budget.remainingUsd.toFixed(2)}
        </p>
        <div className={styles.controlStack}>
          <div className={styles.modeSwitch}>
            <button
              type="button"
              className={mode === "snapshot" ? styles.modeButtonActive : styles.modeButton}
              onClick={() => onModeChange("snapshot")}
            >
              Snapshot
            </button>
            <button
              type="button"
              className={mode === "replay" ? styles.modeButtonActive : styles.modeButton}
              onClick={() => onModeChange("replay")}
            >
              Replay
            </button>
          </div>
          {mode === "replay" ? (
            <button type="button" className={styles.replayButton} onClick={onTogglePlaying}>
              {isPlaying ? "Pause replay" : "Play replay"}
            </button>
          ) : null}
          <label className={styles.inlineControl}>
            <span>Max depth: {filters.maxDepth}</span>
            <input
              type="range"
              min={1}
              max={10}
              value={filters.maxDepth}
              onChange={(event) => onSetMaxDepth(Number(event.target.value))}
            />
          </label>
          <label className={styles.inlineControlCheckbox}>
            <input type="checkbox" checked={filters.hideCompleted} onChange={onToggleHideCompleted} />
            <span>Hide completed nodes</span>
          </label>
          <label className={styles.inlineControlCheckbox}>
            <input
              type="checkbox"
              checked={controls.enableClustering}
              onChange={() => onToggleControl("enableClustering")}
            />
            <span>Auto-cluster completed branches</span>
          </label>
          <label className={styles.inlineControlCheckbox}>
            <input type="checkbox" checked={controls.autoLayout} onChange={() => onToggleControl("autoLayout")} />
            <span>Auto layout stabilization</span>
          </label>
        </div>
      </section>
    </aside>
  );
}
