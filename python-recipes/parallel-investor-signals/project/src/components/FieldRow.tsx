import type { Citation, Field } from "../types";
import { ConfidencePill } from "./ConfidencePill";
import { useSourceDrawer } from "./SourceDrawerContext";

// The footnote-style source marker — the signature device of the console.
// Every claim carries one. Clicking it opens the Source drawer with the exact
// excerpt(s) + URL(s) behind the value: proof, not just a link.
export function SourceMarker({
  label,
  value,
  citations,
}: {
  label: string;
  value: string;
  citations: Citation[];
}) {
  const { open } = useSourceDrawer();
  if (!citations.length) return null;
  return (
    <button
      onClick={() => open({ label, value, citations })}
      className="ml-1 inline-flex translate-y-[-2px] items-center rounded-brand border border-line px-1 font-mono text-[10px] leading-tight text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
      title={`${citations.length} source${citations.length > 1 ? "s" : ""} — click to view`}
    >
      {citations.length}
      <span className="ml-0.5 opacity-60">◇</span>
    </button>
  );
}

// One labeled claim: label · value · confidence · source marker. Handles the
// "not found" state honestly — a null value renders as a muted dash, never a
// fabricated string.
export function FieldRow<T extends string | string[]>({
  label,
  group,
  field,
  render,
}: {
  label: string;
  group: string; // e.g. "Funding" — combined with label for the drawer title
  field: Field<T>;
  render?: (value: T) => React.ReactNode;
}) {
  const has = field.value !== null && field.value !== undefined && (!Array.isArray(field.value) || field.value.length > 0);
  const displayValue = has
    ? render
      ? render(field.value as T)
      : Array.isArray(field.value)
        ? (field.value as string[]).join(", ")
        : String(field.value)
    : null;

  return (
    <div className="flex flex-col gap-1 border-b border-line/60 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <div className="w-40 shrink-0 font-mono text-[11px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
        {has ? (
          <span className="text-[15px] leading-snug text-ink">{displayValue}</span>
        ) : (
          <span className="text-[15px] text-muted/60">—</span>
        )}
        {has && field.confidence && <ConfidencePill confidence={field.confidence} />}
        {has && (
          <SourceMarker
            label={`${group} · ${label}`}
            value={Array.isArray(field.value) ? (field.value as string[]).join(", ") : String(field.value)}
            citations={field.citations}
          />
        )}
      </div>
    </div>
  );
}
