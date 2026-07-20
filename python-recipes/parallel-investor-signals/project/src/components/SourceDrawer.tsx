import { useEffect } from "react";
import type { SourceRequest } from "./SourceDrawerContext";
import { hostname } from "../lib/format";

// The Source drawer: slides in from the right and shows the evidence behind a
// single claim — every excerpt and its URL. This is the credibility payoff of
// the whole tool, so it gets real screen space, real quotes, and a clear link.
export function SourceDrawer({
  request,
  onClose,
}: {
  request: SourceRequest | null;
  onClose: () => void;
}) {
  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  const open = request !== null;

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Sources"
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-line bg-bg shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {request && (
          <>
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  {request.label}
                </div>
                <div className="mt-1 truncate text-[15px] text-ink" title={request.value}>
                  {request.value}
                </div>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 rounded-brand border border-line px-2 py-1 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
              >
                Esc
              </button>
            </header>

            <div className="flex items-center gap-2 border-b border-line px-5 py-2.5 font-mono text-[11px] uppercase tracking-wide text-muted">
              <span className="text-accent">◇</span>
              {request.citations.length} source
              {request.citations.length !== 1 ? "s" : ""}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <ol className="flex flex-col gap-4">
                {request.citations.map((c, i) => (
                  <li key={i} className="parallel-card p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-brand bg-surface-2 font-mono text-[10px] text-muted">
                        {i + 1}
                      </span>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="truncate font-mono text-xs text-accent hover:underline"
                        title={c.url}
                      >
                        {hostname(c.url)}
                      </a>
                    </div>
                    {c.excerpts.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {c.excerpts.map((ex, j) => (
                          <blockquote
                            key={j}
                            className="border-l-2 border-accent/40 pl-3 text-[13px] leading-relaxed text-muted"
                          >
                            “{ex}”
                          </blockquote>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[13px] italic text-muted/70">
                        Source cited; no excerpt captured.
                      </p>
                    )}
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-3 inline-block break-all font-mono text-[11px] text-muted hover:text-accent"
                    >
                      {c.url}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
