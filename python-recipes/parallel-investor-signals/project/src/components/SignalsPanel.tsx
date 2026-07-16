import { useCallback, useEffect, useState } from "react";
import type { Signal, SignalsResponse } from "../types";
import { getSignals, refreshSignals } from "../lib/api";
import { hostname } from "../lib/format";

// The Signals view: qualified investor-monitoring hits (repo-root monitor/).
// Every signal came through the monitor→task chain: detected by a per-fund
// Parallel Monitor (or the bootstrap sweep), then verified by a chained Task
// with citations. "Enrich →" hands the company to the single-lookup flow.
export function SignalsPanel({ onEnrich }: { onEnrich: (company: string) => void }) {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getSignals());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load signals.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const checkNow = async () => {
    setChecking(true);
    setError(null);
    try {
      const r = await refreshSignals();
      setLastCheck(
        r.checked === 0
          ? "No new events from the monitors."
          : `${r.checked} new event${r.checked === 1 ? "" : "s"} → ${r.added} qualified signal${r.added === 1 ? "" : "s"}.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed.");
    } finally {
      setChecking(false);
    }
  };

  if (data && !data.available) {
    return (
      <div className="parallel-card mt-6 px-6 py-10 text-center">
        <p className="text-[15px] text-ink">Monitoring isn't available on this deploy.</p>
        <p className="mt-2 text-[13px] text-muted">
          The investor monitors run against the local repo (<span className="font-mono">monitor/</span>).
          Run the app locally to see and drain signals.
        </p>
      </div>
    );
  }

  const signals = data?.signals ?? [];
  const newOnes = signals.filter((s) => !s.known_portco).length;
  const live = data?.mode === "live";

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl text-ink">Investor signals</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            AI-native seed–Series B rounds backed by watched funds ·{" "}
            {data ? `${data.monitors.length} monitors active, daily` : "…"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastCheck && <span className="font-mono text-[11px] text-muted">{lastCheck}</span>}
          {/* In live mode every page load already fetches the latest events —
              there's no drain step, so no button. */}
          {live ? (
            <span className="rounded-brand border border-accent/40 px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-accent">
              live view
            </span>
          ) : (
            <button
              onClick={checkNow}
              disabled={checking}
              className="parallel-btn px-4 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking ? "Checking monitors…" : "Check for new events"}
            </button>
          )}
        </div>
      </div>

      {/* What this page is — for anyone landing here cold */}
      <div className="parallel-card px-5 py-4">
        <p className="text-[14px] leading-relaxed text-ink">
          Every time a fund on your watchlist backs an{" "}
          <span className="font-medium">AI-native company at seed through
          Series B</span>, it surfaces here. Parallel Monitors scan the web for these rounds
          daily{live ? (
            <>
              . This is the <span className="font-medium">live view</span>: raw detections
              fetched straight from the monitors on each page load, with their citations —
              chain-verification of each event runs in the local pipeline.
            </>
          ) : (
            <>
              ; each detection is then verified by a follow-up research task before it
              becomes a signal, so everything below is confirmed and cited — click a source
              chip for the evidence.
            </>
          )}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-muted">
          <span>
            <span className="rounded-brand border border-accent/50 px-1.5 py-0.5 uppercase tracking-wide text-accent">new — not on sheet</span>
            {" "}worth a look for pipeline
          </span>
          <span>
            <span className="rounded-brand border border-line px-1.5 py-0.5 uppercase tracking-wide">known portco</span>
            {" "}already on your known-companies list
          </span>
          <span>◉ caught live by a monitor</span>
          <span>◇ found by the 60-day bootstrap sweep</span>
          <span className="text-muted/70">Enrich → runs the full cited account brief</span>
        </div>
      </div>

      {error && (
        <div className="parallel-card border-accent/40 px-4 py-3 text-[14px] text-ink">{error}</div>
      )}

      {data && signals.length > 0 && (
        <div className="flex gap-2 font-mono text-[11px] text-muted">
          <span className="rounded-brand border border-line px-2 py-1">{signals.length} signals</span>
          <span className="rounded-brand border border-accent/40 px-2 py-1 text-accent">
            {newOnes} not on portco sheet
          </span>
        </div>
      )}

      {!data && !error && (
        <div className="parallel-card px-5 py-8 font-mono text-[13px] text-muted">Loading signals…</div>
      )}

      {data && signals.length === 0 && (
        <div className="parallel-card px-6 py-10 text-center text-[14px] text-muted">
          No signals yet. Run the bootstrap sweep (<span className="font-mono">python monitor/sweep.py</span>)
          or check for new events above.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {signals.map((s, i) => (
          <SignalCard key={`${s.company}-${s.round_stage}-${i}`} signal={s} onEnrich={onEnrich} />
        ))}
      </div>
    </div>
  );
}

const PRIORITY_STYLE: Record<string, string> = {
  high: "border-accent/60 text-accent",
  medium: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  digest: "border-line text-muted",
};

function SignalCard({ signal: s, onEnrich }: { signal: Signal; onEnrich: (c: string) => void }) {
  const investors = [s.lead_investor, s.co_investors || s.investors]
    .filter((x) => x && x !== "NA")
    .join(" + ");
  return (
    <div className="parallel-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-medium text-ink">{s.company}</span>
            <span className="rounded-brand bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
              {s.round_stage || "—"}
            </span>
            {s.amount && s.amount !== "NA" && (
              <span className="font-mono text-[13px] text-ink">{s.amount}</span>
            )}
            {s.priority && (
              <span
                className={`rounded-brand border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${PRIORITY_STYLE[s.priority]}`}
                title="Trigger priority: stage (Seed/A weighted) + raise size + fit rating + net-new"
              >
                {s.priority}
              </span>
            )}
            {typeof s.parallel_fit_rating === "number" && s.parallel_fit_rating > 0 && (
              <span
                className="rounded-brand border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted"
                title={s.fit_reasoning || "Auto Parallel-fit rating (1-10)"}
              >
                fit {s.parallel_fit_rating}/10
              </span>
            )}
            {s.known_portco ? (
              <span className="rounded-brand border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
                known portco
              </span>
            ) : (
              <span className="rounded-brand border border-accent/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">
                new — not on sheet
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[14px] leading-snug text-muted">
            {s.one_liner || s.summary || ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
            <span className="text-ink">{s.fund_watched}</span>
            {investors && <span>{investors}</span>}
            {s.sector && s.sector !== "NA" && <span>{s.sector}</span>}
            {s.announced_date && s.announced_date !== "NA" && <span>{s.announced_date}</span>}
            <span className="uppercase">{s.detected_via === "monitor" ? "◉ live monitor" : "◇ sweep"}</span>
          </div>
          {/* CRM-backed pipeline status; in-pipeline links to the record */}
          {s.pipeline_label && (
            <div className="mt-1.5 font-mono text-[11px] text-muted">
              pipeline:{" "}
              {s.crm_url ? (
                <a
                  href={s.crm_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent hover:underline"
                >
                  {s.pipeline_label} ↗
                </a>
              ) : (
                <span className="text-ink">{s.pipeline_label}</span>
              )}
            </div>
          )}
          {/* The intro path: warm intros go through the investing partner */}
          {s.investing_partner && s.investing_partner !== "NA" && (
            <div className="mt-1.5 font-mono text-[11px]">
              <span className="text-accent">intro path →</span>{" "}
              <span className="text-ink">{s.investing_partner}</span>
            </div>
          )}
          {s.founders && s.founders !== "NA" && (
            <div className="mt-0.5 font-mono text-[11px] text-muted">founders: {s.founders}</div>
          )}
          {(s.sources || []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.sources.slice(0, 4).map((u) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-brand border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-accent hover:text-accent"
                  title={u}
                >
                  {hostname(u)}
                </a>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => onEnrich(s.domain && s.domain !== "NA" ? s.domain : s.company)}
          className="shrink-0 rounded-brand border border-line px-3 py-1.5 font-mono text-[12px] text-muted transition-colors hover:border-accent hover:text-accent"
          title="Run the full cited enrichment for this company"
        >
          Enrich →
        </button>
      </div>
    </div>
  );
}
