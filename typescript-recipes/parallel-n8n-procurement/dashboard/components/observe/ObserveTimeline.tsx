"use client";

import { useMemo } from "react";
import type { ObserveTimelineEvent } from "@/lib/observe-types";
import styles from "@/components/observe/observe-workspace.module.css";

export function ObserveTimeline({
  events,
  mode,
  isPlaying,
  onTogglePlaying,
  playheadIndex,
  onPlayheadChange,
  onStep,
}: {
  events: ObserveTimelineEvent[];
  mode: "snapshot" | "replay";
  isPlaying: boolean;
  onTogglePlaying: () => void;
  playheadIndex: number;
  onPlayheadChange: (index: number) => void;
  onStep: (direction: -1 | 1) => void;
}) {
  const activeEvent = useMemo(() => events[Math.max(0, Math.min(playheadIndex, events.length - 1))], [events, playheadIndex]);
  const replayEnabled = mode === "replay";
  const eventPreview = events.slice(Math.max(0, playheadIndex - 2), playheadIndex + 1);

  return (
    <section className={`surface-panel ${styles.timelinePanel}`}>
      <div className="section-heading">
        <div>
          <div className="eyebrow">Replay timeline</div>
          <h2 className={styles.panelHeading}>Spawn chronology</h2>
        </div>
        {replayEnabled ? (
          <button type="button" className={styles.replayButton} onClick={onTogglePlaying}>
            {isPlaying ? "Pause" : "Play"}
          </button>
        ) : null}
      </div>

      <div className={styles.timelineControls}>
        <button type="button" onClick={() => onStep(-1)} disabled={!replayEnabled || playheadIndex <= 0}>
          Step back
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(events.length - 1, 0)}
          value={Math.max(playheadIndex, 0)}
          onChange={(event) => onPlayheadChange(Number(event.target.value))}
          disabled={!replayEnabled}
        />
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={!replayEnabled || playheadIndex >= events.length - 1}
        >
          Step forward
        </button>
      </div>

      <p className={styles.panelBody}>
        {replayEnabled && activeEvent
          ? `${activeEvent.summary} (${new Date(activeEvent.happenedAt).toLocaleTimeString("en-US", { hour12: true })})`
          : "Snapshot mode is active. Switch to Replay to scrub the spawn chain over time."}
      </p>

      <div className={styles.timelineList}>
        {eventPreview.map((event) => {
          const index = events.findIndex((candidate) => candidate.id === event.id);
          return (
          <button
            key={event.id}
            type="button"
            className={index === playheadIndex ? styles.timelineRowActive : styles.timelineRow}
            onClick={() => onPlayheadChange(index)}
            disabled={!replayEnabled}
          >
            <span>{new Date(event.happenedAt).toLocaleTimeString("en-US", { hour12: true })}</span>
            <strong>{event.summary}</strong>
          </button>
          );
        })}
      </div>
    </section>
  );
}
