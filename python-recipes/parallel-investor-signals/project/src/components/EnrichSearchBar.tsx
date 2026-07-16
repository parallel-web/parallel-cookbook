import type { Depth } from "../types";

// The single-lookup input: company name or domain + a depth toggle. Depth maps
// server-side to a Parallel processor tier (fast=core-fast, deep=pro-fast) —
// safe to switch live if the network is slow on a call. Query is controlled by
// App so the custom-fields box can trigger the same lookup.
export function EnrichSearchBar({
  query,
  onQueryChange,
  onSubmit,
  loading,
  depth,
  onDepthChange,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: (query: string) => void;
  loading: boolean;
  depth: Depth;
  onDepthChange: (d: Depth) => void;
}) {
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q && !loading) onSubmit(q);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted">
            ▸
          </span>
          <input
            id="enrich-input"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Company name or domain — e.g. ramp.com"
            disabled={loading}
            autoFocus
            className="w-full rounded-brand border border-line bg-surface py-3 pl-8 pr-10 text-[15px] text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent disabled:opacity-60"
          />
          {/* "/" focuses the search from anywhere — see the App-level listener */}
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-brand border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted/60">
            /
          </kbd>
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="parallel-btn px-5 py-3 text-[14px] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Researching…" : "Enrich"}
        </button>
      </div>

      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-muted">
        <span>Depth</span>
        <div className="flex rounded-brand border border-line p-0.5">
          {(["fast", "deep"] as Depth[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDepthChange(d)}
              className={`rounded-[calc(var(--radius)-2px)] px-2.5 py-1 capitalize transition-colors ${
                depth === d ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <span className="text-muted/60 normal-case tracking-normal">
          {depth === "fast" ? "core-fast · seconds" : "pro-fast · deeper, slower"}
        </span>
      </div>
    </form>
  );
}
