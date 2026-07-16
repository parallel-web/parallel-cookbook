import { useEffect, useRef, useState } from "react";
import type { CustomFieldResult, Depth, ResearchBrief } from "../types";
import { ApiError, enrichCustomFields } from "../lib/api";
import { SourceMarker } from "./FieldRow";
import { ConfidencePill } from "./ConfidencePill";

// Ad-hoc research about the company on screen: ask a question, get a cited
// answer inline. Nothing touches the profile unless the rep clicks "Add to
// profile" — answers here are ephemeral (and reset when the company changes).
export function AskBar({
  brief,
  depth,
  onAddToProfile,
}: {
  brief: ResearchBrief;
  depth: Depth;
  onAddToProfile: (result: CustomFieldResult) => void;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // question in flight
  const [answers, setAnswers] = useState<CustomFieldResult[]>([]); // newest first
  const [error, setError] = useState<string | null>(null);

  // New company on screen -> clear the session Q&A.
  const companyRef = useRef(brief.query);
  useEffect(() => {
    if (companyRef.current !== brief.query) {
      companyRef.current = brief.query;
      setAnswers([]);
      setQuestion("");
      setError(null);
    }
  }, [brief.query]);

  const norm = (s: string) => s.trim().toLowerCase();
  const inProfile = new Set((brief.custom_fields ?? []).map((c) => norm(c.question)));

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    // Already answered this session — just surface it (no repeat spend).
    if (answers.some((a) => norm(a.question) === norm(q))) {
      setQuestion("");
      return;
    }
    setError(null);
    setAsking(true);
    setPending(q);
    try {
      const res = await enrichCustomFields(brief.query, depth, [
        { label: q.slice(0, 60), question: q },
      ]);
      const answer = res.custom_fields[0];
      if (answer) setAnswers((prev) => [answer, ...prev]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Research failed. Try again.");
    } finally {
      setAsking(false);
      setPending(null);
    }
  };

  return (
    <div className="mt-4 parallel-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted">
            ?
          </span>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder={`Ask anything about ${brief.company_name} — e.g. Are they SOC 2 compliant?`}
            disabled={asking}
            className="w-full rounded-brand border border-line bg-surface py-2.5 pl-8 pr-3 text-[14px] text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-accent disabled:opacity-60"
          />
        </div>
        <button
          type="button"
          onClick={ask}
          disabled={asking || !question.trim()}
          className="parallel-btn px-4 py-2.5 text-[13px] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {asking ? "Researching…" : "Ask"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted/70">
        Answered live from the web, with citations. No cited source → no answer.
      </p>

      {error && <p className="mt-2 text-[13px] text-accent">{error}</p>}

      {(pending || answers.length > 0) && (
        <div className="mt-2 flex flex-col">
          {pending && (
            <div className="flex flex-col gap-1 border-b border-line/60 py-2.5 last:border-b-0">
              <p className="text-[13px] text-ink">{pending}</p>
              <span className="animate-pulse text-[13px] text-muted/60">researching…</span>
            </div>
          )}
          {answers.map((a) => {
            const added = inProfile.has(norm(a.question));
            const has = a.field.value !== null;
            return (
              <div
                key={a.question}
                className="flex flex-col gap-1 border-b border-line/60 py-2.5 last:border-b-0"
              >
                <p className="text-[13px] text-muted">{a.question}</p>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {has ? (
                    <>
                      <span className="text-[15px] leading-snug text-ink">
                        {String(a.field.value)}
                      </span>
                      {a.field.confidence && <ConfidencePill confidence={a.field.confidence} />}
                      <SourceMarker
                        label={`Custom research · ${a.label}`}
                        value={String(a.field.value)}
                        citations={a.field.citations}
                      />
                      <button
                        type="button"
                        onClick={() => onAddToProfile(a)}
                        disabled={added}
                        className={`ml-auto rounded-brand border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                          added
                            ? "border-line text-muted/60"
                            : "border-line text-muted hover:border-accent hover:text-accent"
                        }`}
                      >
                        {added ? "Added ✓" : "+ Add to profile"}
                      </button>
                    </>
                  ) : (
                    <span className="text-[14px] text-muted/60">
                      No cited answer found — not guessing.
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
