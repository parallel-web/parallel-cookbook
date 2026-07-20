import { useEffect, useMemo, useState } from "react";
import type { Depth } from "../types";

// The live-research loading experience. A core-fast run takes 15–100s, so the
// wait has to feel like WORK IS HAPPENING, not like a spinner. We show:
//   * an elapsed mono timer (honesty — no fake progress bar)
//   * the two real research runs (account + contacts) as parallel streams
//   * staged narrative lines keyed to realistic phase timing
// Stages are cosmetic pacing only — the actual completion is whenever the API
// returns; nothing here pretends to know more than it does.

const STAGES: { at: number; label: string }[] = [
  { at: 0, label: "Dispatching research runs to the Parallel Task API" },
  { at: 6, label: "Searching the live web for company evidence" },
  { at: 18, label: "Reading sources — filings, press, careers pages, docs" },
  { at: 38, label: "Cross-referencing claims across independent sources" },
  { at: 60, label: "Scoring confidence and attaching citations" },
  { at: 85, label: "Composing the cited brief — deep runs take a little longer" },
];

function useElapsed(): number {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setS((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return s;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}:${String(r).padStart(2, "0")}` : `0:${String(r).padStart(2, "0")}`;
}

export function LiveResearchState({ query, depth }: { query: string; depth: Depth }) {
  const elapsed = useElapsed();

  const stageIdx = useMemo(() => {
    let idx = 0;
    for (let i = 0; i < STAGES.length; i++) if (elapsed >= STAGES[i].at) idx = i;
    return idx;
  }, [elapsed]);

  const runs = [
    { label: "Account run", detail: "firmographics · funding · tech · signals" },
    { label: "Contacts run", detail: "decision-makers · titles · LinkedIn" },
  ];

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* Status line: what + how long, in plain terms */}
      <div className="parallel-card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
            </span>
            <span className="text-[15px] text-ink">
              Researching <span className="font-medium">{query}</span> on the live web
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[12px] text-muted">
            <span className="rounded-brand border border-line px-2 py-0.5">
              {depth === "fast" ? "core-fast" : "pro-fast"}
            </span>
            <span className="rounded-brand border border-line px-2 py-0.5 tabular-nums">
              {fmt(elapsed)}
            </span>
          </div>
        </div>

        {/* The real runs, as parallel streams */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {runs.map((r) => (
            <div
              key={r.label}
              className="flex items-center gap-3 rounded-brand border border-line bg-bg px-3 py-2"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink">
                {r.label}
              </span>
              <span className="truncate font-mono text-[11px] text-muted">{r.detail}</span>
            </div>
          ))}
        </div>

        {/* Staged narrative — past stages dim, current one is live */}
        <ol className="mt-1 flex flex-col gap-1.5">
          {STAGES.slice(0, stageIdx + 1).map((s, i) => (
            <li
              key={s.at}
              className={`flex items-center gap-2 font-mono text-[12px] ${
                i === stageIdx ? "text-ink" : "text-muted/50"
              }`}
            >
              <span className={i === stageIdx ? "text-accent" : ""}>
                {i === stageIdx ? "▸" : "✓"}
              </span>
              {s.label}
              {i === stageIdx && <span className="animate-pulse">…</span>}
            </li>
          ))}
        </ol>
      </div>

      {/* Skeleton of the brief that's coming */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden>
        {[0, 1, 2, 3].map((s) => (
          <div key={s} className="parallel-card p-5">
            <div className="mb-4 h-3 w-36 animate-pulse rounded bg-surface-2" />
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((r) => (
                <div key={r} className="flex gap-4">
                  <div className="h-3 w-28 animate-pulse rounded bg-surface-2" />
                  <div className="h-3 flex-1 animate-pulse rounded bg-surface-2/60" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
