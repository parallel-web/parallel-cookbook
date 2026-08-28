"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";

interface NewsletterIssueProps {
  onClose: () => void;
}

interface IssueMeta {
  issueNumber: number;
  weekOf: string;
  hasContent: boolean;
  focus?: string;
  generatedAt?: string;
  stats?: { events?: number; critical?: number; markets?: number };
  isCurrent: boolean;
}

type ReadStatus = "loading" | "ready" | "generating" | "not_found";

/** Strip email-only chrome that may linger in older stored issue bodies. */
function sanitize(html: string): string {
  return html
    .replace(/\{\{UNSUBSCRIBE_URL\}\}/g, "#")
    .replace(/<a[^>]*>\s*Unsubscribe\s*<\/a>/gi, "");
}

export function NewsletterIssue({ onClose }: NewsletterIssueProps) {
  const [issues, setIssues] = useState<IssueMeta[]>([]);
  const [currentIssue, setCurrentIssue] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState<ReadStatus>("loading");
  const [contentByIssue, setContentByIssue] = useState<Record<number, string>>({});
  const [metaByIssue, setMetaByIssue] = useState<Record<number, IssueMeta>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedMeta = selected != null ? metaByIssue[selected] : undefined;

  function clearPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function loadIssue(n: number) {
    setSelected(n);
    clearPoll();
    if (contentByIssue[n]) { setStatus("ready"); return; }
    setStatus("loading");
    try {
      const res = await fetch(`/api/newsletter/preview?issue=${n}`);
      const data = await res.json();
      if (data.status === "found" && data.content) {
        setContentByIssue((p) => ({ ...p, [n]: sanitize(data.content) }));
        setStatus("ready");
      } else if (data.status === "generating") {
        setStatus("generating");
        startPolling(n);
      } else {
        setStatus("not_found");
      }
    } catch {
      setStatus("not_found");
    }
  }

  function startPolling(n: number) {
    clearPoll();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/newsletter/preview?issue=${n}`);
        const data = await res.json();
        if (data.status === "found" && data.content) {
          clearPoll();
          setContentByIssue((p) => ({ ...p, [n]: sanitize(data.content) }));
          setMetaByIssue((p) => ({ ...p, [n]: { ...(p[n] || {} as IssueMeta), hasContent: true } }));
          setStatus("ready");
        }
      } catch {}
    }, 10000);
    setTimeout(clearPoll, 360000);
  }

  async function handleGenerate(n: number) {
    setStatus("generating");
    fetch("/api/newsletter/generate", { method: "POST" }).catch(() => {});
    startPolling(n);
  }

  // Load the archive on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/newsletter/issues");
        const data = await res.json();
        if (cancelled) return;
        const list: IssueMeta[] = data.issues || [];
        const cur: number = data.currentIssue || 0;
        setCurrentIssue(cur);

        // Ensure the current week is always represented, even if not yet generated
        const merged = [...list];
        if (cur && !merged.some((i) => i.issueNumber === cur)) {
          const ms = new Date("2024-01-01").getTime() + cur * 7 * 24 * 60 * 60 * 1000;
          merged.unshift({
            issueNumber: cur,
            weekOf: new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
            hasContent: false,
            isCurrent: true,
          });
        }
        merged.sort((a, b) => b.issueNumber - a.issueNumber);
        setIssues(merged);
        setMetaByIssue(Object.fromEntries(merged.map((i) => [i.issueNumber, i])));

        const first = merged.find((i) => i.hasContent) || merged[0];
        if (first) loadIssue(first.issueNumber);
        else setStatus("not_found");
      } catch {
        if (!cancelled) setStatus("not_found");
      }
    })();
    return () => { cancelled = true; clearPoll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const content = selected != null ? contentByIssue[selected] : "";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: "rgba(29, 27, 22, 0.6)" }}>
      <div className="bg-white rounded-[8px] border border-[#E5E5E5] shadow-xl w-[960px] max-w-[94vw] h-[86vh] overflow-hidden flex flex-col">
        {/* Masthead */}
        <div className="flex items-center justify-between px-[18px] py-[12px] border-b border-[#E5E5E5] bg-[#FCFBFA] shrink-0">
          <div className="flex items-baseline gap-[10px]">
            <span className="font-mono font-bold text-[15px] text-[#1D1B16] tracking-[-0.01em]">parallel</span>
            <span className="font-mono uppercase text-[10px] tracking-[0.12em] text-[#1D1B16]">Weekly newsletter</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-[6px] font-mono uppercase text-[9px] tracking-[0.05em] text-[#FB631B] bg-[#FCDDCF] px-2 py-[3px] rounded-[3px]">
              <span className="w-[5px] h-[5px] rounded-full bg-[#FB631B]" style={{ animation: "pulse-dot 2s ease-in-out infinite" }} />
              Built with Task API
            </span>
            <button onClick={onClose} className="text-[#A6A5A4] hover:text-[#181818] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Archive rail */}
          <aside className="w-[236px] shrink-0 border-r border-[#E5E5E5] bg-[#FCFBFA] flex flex-col">
            <div className="px-[16px] pt-[14px] pb-[8px] shrink-0">
              <div className="font-mono uppercase text-[9px] tracking-[0.08em] text-[#A6A5A4]">The archive</div>
            </div>
            <div className="flex-1 overflow-y-auto px-[10px] pb-[10px]">
              {issues.map((iss) => {
                const isActive = selected === iss.issueNumber;
                return (
                  <button
                    key={iss.issueNumber}
                    onClick={() => loadIssue(iss.issueNumber)}
                    className={`w-full text-left rounded-[6px] px-[12px] py-[10px] mb-[4px] border transition-colors ${
                      isActive
                        ? "bg-white border-[#F9BC9F]"
                        : "bg-transparent border-transparent hover:bg-white/70 hover:border-[#EFEDE8]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-[3px]">
                      <span className="font-mono text-[12px] font-medium text-[#1D1B16]">Issue {iss.issueNumber}</span>
                      {iss.isCurrent && (
                        <span className="font-mono uppercase text-[7.5px] tracking-[0.06em] text-[#FB631B] border border-[#F9BC9F] rounded-[2px] px-[4px] py-[1px]">This week</span>
                      )}
                    </div>
                    <div className="font-mono text-[9.5px] text-[#858483] mb-[4px]">Week of {iss.weekOf}</div>
                    {iss.focus ? (
                      <div className="text-[10.5px] leading-[14px] text-[#5C5B59] line-clamp-2">{iss.focus}</div>
                    ) : iss.hasContent ? (
                      <div className="font-mono text-[9px] text-[#A6A5A4]">Weekly brief</div>
                    ) : (
                      <div className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#A6A5A4]">Not generated yet</div>
                    )}
                    {iss.stats?.critical != null && (
                      <div className="mt-[6px] font-mono text-[8.5px] text-[#A6A5A4]">
                        {iss.stats.events ?? 0} events · <span className="text-[#E14942]">{iss.stats.critical} critical</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="px-[16px] py-[11px] border-t border-[#E5E5E5] shrink-0">
              <div className="font-mono text-[9px] text-[#A6A5A4] leading-[14px]">
                New issue every Monday, 7:00 AM ET
              </div>
            </div>
          </aside>

          {/* Reader pane */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Provenance strip */}
            {selectedMeta && (
              <div className="px-[22px] py-[10px] border-b border-[#E5E5E5] bg-white shrink-0 flex items-center gap-4 flex-wrap">
                <span className="font-mono text-[9px] leading-[14px] text-[#858483]">
                  Deep-researched and written by <span className="text-[#FB631B]">Parallel Task API</span> across 31 monitors — every claim links to a source.
                </span>
                {selectedMeta.stats?.events != null && (
                  <span className="font-mono text-[9px] text-[#A6A5A4] ml-auto whitespace-nowrap">
                    {selectedMeta.stats.events} events · {selectedMeta.stats.markets ?? "—"} markets analyzed
                  </span>
                )}
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto bg-white">
              {status === "loading" && (
                <div className="flex items-center justify-center py-24">
                  <Loader2 className="w-4 h-4 text-[#FB631B] animate-spin" />
                  <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.05em] text-[#A6A5A4]">Loading issue…</span>
                </div>
              )}

              {status === "generating" && (
                <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
                  <Loader2 className="w-5 h-5 text-[#FB631B] animate-spin mb-3" />
                  <span className="font-mono uppercase text-[10.4px] tracking-[0.06em] text-[#FB631B] mb-1">Generating brief…</span>
                  <span className="font-mono text-[9px] text-[#A6A5A4] max-w-[340px]">
                    Parallel&apos;s Task API is deep-researching this week&apos;s critical events across all 31 monitors. Takes 3–5 minutes.
                  </span>
                </div>
              )}

              {status === "not_found" && (
                <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
                  <div className="font-mono uppercase text-[10.4px] tracking-[0.06em] text-[#A6A5A4] mb-3">
                    {selected === currentIssue ? "This week's issue isn't out yet" : "No issue here"}
                  </div>
                  <p className="text-[14px] text-[#858483] mb-6 max-w-[400px] leading-[21px]">
                    Generate it now from your live monitor events — Parallel&apos;s Task API deep-researches each critical development and writes the brief.
                  </p>
                  <button
                    onClick={() => handleGenerate(selected ?? currentIssue)}
                    className="font-mono uppercase text-[12px] tracking-[0.04em] px-6 py-2.5 bg-[#FB631B] text-white rounded-[6px] hover:bg-[#F4793F] transition-colors"
                  >
                    Generate this issue
                  </button>
                  <span className="font-mono text-[9px] text-[#A6A5A4] mt-3">Takes 3–5 minutes</span>
                </div>
              )}

              {status === "ready" && content && (
                <div className="newsletter-body px-[22px] py-[18px] max-w-[720px]" dangerouslySetInnerHTML={{ __html: content }} />
              )}
            </div>

            {/* Footer */}
            <div className="px-[22px] py-[10px] border-t border-[#E5E5E5] bg-white shrink-0 flex items-center justify-between">
              <span className="font-mono text-[9px] text-[#A6A5A4]">
                Datacenter Signal · Published weekly · Powered by Parallel Task API
              </span>
              <span className="font-mono text-[9px] text-[#A6A5A4]">hello@parallel.ai</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
