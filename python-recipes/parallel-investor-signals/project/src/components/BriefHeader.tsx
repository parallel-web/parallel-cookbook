import type { ResearchBrief } from "../types";
import { formatLatency } from "../lib/format";
import { agoLabel } from "../lib/cache";

// Counts how many of the ~15 account fields came back with a value — a quick
// "signal strength" read for the rep, and the trigger for a low-signal banner.
function coverage(brief: ResearchBrief): { filled: number; total: number } {
  const f = brief.firmographics;
  const fn = brief.funding;
  const fields = [
    f.industry, f.hq, f.employee_count, f.founded_year, f.description,
    fn.total_raised, fn.last_round, fn.investors, fn.valuation, fn.revenue_estimate,
    brief.technographics.tech_stack, brief.buying_signals,
  ];
  const filled = fields.filter((x) => {
    const v = x.value;
    return v !== null && v !== undefined && (!Array.isArray(v) || v.length > 0);
  }).length;
  return { filled, total: fields.length };
}

export function BriefHeader({
  brief,
  cachedAt,
  onRefresh,
  saved = false,
  onSave,
}: {
  brief: ResearchBrief;
  cachedAt?: number | null;
  onRefresh?: () => void;
  saved?: boolean; // this company already has a saved profile (kept in sync)
  onSave?: () => void;
}) {
  const { filled, total } = coverage(brief);
  const lowSignal = filled <= 3;

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl leading-none text-ink">{brief.company_name}</h1>
          {brief.domain && (
            <a
              href={`https://${brief.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-block font-mono text-[13px] text-accent hover:underline"
            >
              {brief.domain} ↗
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
          {/* Honest provenance: cached results say so, with one-click live refresh */}
          {cachedAt ? (
            <>
              <span className="rounded-brand border border-accent/40 px-2 py-1 text-accent">
                cached {agoLabel(cachedAt)}
              </span>
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="rounded-brand border border-line px-2 py-1 transition-colors hover:border-accent hover:text-accent"
                >
                  Refresh live ↻
                </button>
              )}
            </>
          ) : (
            <span className="rounded-brand border border-line px-2 py-1">
              {formatLatency(brief.meta.latency_ms)}
            </span>
          )}
          <span className="rounded-brand border border-line px-2 py-1">
            {brief.meta.processor}
          </span>
          <span className="rounded-brand border border-line px-2 py-1">
            {filled}/{total} fields
          </span>
          {onSave &&
            (saved ? (
              <span
                className="rounded-brand border border-line px-2 py-1 text-muted/70"
                title="Saved to your profiles — updates automatically"
              >
                Saved ✓
              </span>
            ) : (
              <button
                onClick={onSave}
                className="rounded-brand border border-accent/60 px-2 py-1 text-accent transition-colors hover:bg-accent/10"
              >
                Save profile +
              </button>
            ))}
        </div>
      </div>

      {lowSignal && (
        <div className="parallel-card border-accent/40 px-4 py-2.5 text-[13px] text-muted">
          Low signal — we found little public data for this query. Try the full
          company name or its primary domain.
        </div>
      )}
      {brief.meta.partial && !lowSignal && (
        <div className="parallel-card border-accent/40 px-4 py-2.5 text-[13px] text-muted">
          Partial result — some fields timed out. The values shown are still
          fully sourced.
        </div>
      )}
    </div>
  );
}
