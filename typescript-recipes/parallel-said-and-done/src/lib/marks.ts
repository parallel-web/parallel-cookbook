/**
 * Mapping from Task enum values to the marks the sheet draws. Pure lookups,
 * shared by the pipeline and the pages.
 */
import type { OutcomeKey, OutcomeStatus, Stance, StanceKey } from "./types";

export const OUTCOME_KEY: Record<OutcomeStatus, OutcomeKey> = {
  delivered: "done",
  exceeded: "done",
  partly_delivered: "part",
  revised: "rev",
  open: "open",
  missed: "miss",
  dropped: "drop",
};

export const OUTCOME_KEYS: OutcomeKey[] = ["done", "part", "rev", "open", "miss", "drop"];

export const STANCE_KEY: Record<Stance, StanceKey> = {
  stated: "s",
  reaffirmed: "h",
  on_track: "h",
  ahead: "h",
  raised: "c",
  lowered: "c",
  softened: "c",
  revised: "c",
  dropped: "c",
  declared_done: "d",
  not_mentioned: "x",
};

export function stanceLabel(stance: Stance): string {
  return stance.replace(/_/g, " ").toUpperCase();
}

