// Empty / loading / error states. Each is an invitation or a direction, never
// filler — copy is written from the rep's side of the screen.

const EXAMPLES = ["ramp.com", "Anthropic", "Vercel", "stripe.com"];

export function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="parallel-card mt-6 flex flex-col items-center gap-5 px-6 py-16 text-center">
      <div className="font-mono text-[11px] uppercase tracking-wide text-accent">
        Cited, real-time account intelligence
      </div>
      <h2 className="max-w-xl text-2xl leading-snug text-ink">
        Enrich any company from the live web — firmographics, funding, tech
        stack, buying signals, and decision-makers, each with its source.
      </h2>
      <p className="max-w-md text-[14px] text-muted">
        Type a company name or domain above. Every field you get back can be
        traced to the exact page it came from.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="font-mono text-[11px] text-muted">Try</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => onPick(ex)}
            className="rounded-brand border border-line px-2.5 py-1 font-mono text-[12px] text-muted transition-colors hover:border-accent hover:text-accent"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  hint,
  onRetry,
}: {
  message: string;
  hint?: string;
  onRetry: () => void;
}) {
  return (
    <div className="parallel-card mt-6 flex flex-col items-start gap-3 border-accent/40 px-6 py-8">
      <div className="font-mono text-[11px] uppercase tracking-wide text-accent">
        Enrichment failed
      </div>
      <p className="text-[15px] text-ink">{message}</p>
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      <button
        onClick={onRetry}
        className="mt-1 rounded-brand border border-line px-3 py-1.5 font-mono text-[12px] text-muted transition-colors hover:border-accent hover:text-accent"
      >
        Try again
      </button>
    </div>
  );
}
