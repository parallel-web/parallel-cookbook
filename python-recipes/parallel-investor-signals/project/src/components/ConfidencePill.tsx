import type { Confidence } from "../types";
import { CONFIDENCE_LABEL } from "../lib/format";

// A small monospace pill communicating how well-grounded a value is. Kept
// deliberately quiet (no loud color fills) so orange stays reserved for the
// primary action. "Inferred" is visually distinct — it is our honesty signal
// (e.g. email patterns are guessed, never claimed as verified).
const STYLES: Record<Confidence, string> = {
  high: "text-emerald-700 dark:text-emerald-400 border-emerald-600/30",
  medium: "text-amber-700 dark:text-amber-400 border-amber-600/30",
  low: "text-muted border-line",
  inferred: "text-accent border-accent/40",
};

const DOT: Record<Confidence, string> = {
  high: "bg-emerald-600 dark:bg-emerald-400",
  medium: "bg-amber-600 dark:bg-amber-400",
  low: "bg-muted",
  inferred: "bg-accent",
};

export function ConfidencePill({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-brand border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${STYLES[confidence]}`}
      title={CONFIDENCE_LABEL[confidence]}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[confidence]}`} />
      {confidence}
    </span>
  );
}
