import { useMemo, useRef, useState } from "react";
import type { CustomFieldDef } from "../types";
import { blankDef } from "../lib/customFields";

const MAX_FIELDS = 8;

// Ad-hoc research questions for BULK runs (the Clay-style custom columns):
// every company in the batch gets each question answered as an extra column.
// Answers are citation-gated just like the built-in fields — no source, no
// value. Per-session only; a refresh starts clean.
export function CustomFieldsEditor({
  defs,
  onChange,
  disabled = false,
}: {
  defs: CustomFieldDef[];
  onChange: (defs: CustomFieldDef[]) => void;
  disabled?: boolean;
}) {
  // Stable ids per row so inputs don't lose focus on add/remove. Seed once
  // (guarded, so the id counter isn't bumped as a side effect every render).
  const idRef = useRef(0);
  const idsRef = useRef<number[]>([]);
  const seededRef = useRef(false);
  if (!seededRef.current) {
    seededRef.current = true;
    idsRef.current = defs.map(() => idRef.current++);
  }
  while (idsRef.current.length < defs.length) idsRef.current.push(idRef.current++);

  const [open, setOpen] = useState(defs.length > 0);

  const activeCount = useMemo(() => defs.filter((d) => d.question.trim()).length, [defs]);

  const update = (i: number, patch: Partial<CustomFieldDef>) =>
    onChange(defs.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const addRow = () => {
    if (defs.length >= MAX_FIELDS) return;
    idsRef.current.push(idRef.current++);
    onChange([...defs, blankDef()]);
  };

  const removeRow = (i: number) => {
    idsRef.current.splice(i, 1);
    onChange(defs.filter((_, j) => j !== i));
  };

  return (
    <div className="mt-3 parallel-card p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-[12px] uppercase tracking-wide text-muted">
            Custom research fields
          </span>
          {activeCount > 0 && (
            <span className="rounded-brand bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
              {activeCount}
            </span>
          )}
        </span>
        <span className="font-mono text-[11px] text-muted/70">
          {open ? "hide ▲" : "add your own questions ▼"}
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-[12px] text-muted">
            Ask anything about each account — answered live from the web, with citations.
            Unanswerable questions come back blank, never guessed.
          </p>

          {defs.map((d, i) => (
            <div
              key={idsRef.current[i]}
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <input
                value={d.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Label (e.g. SOC2)"
                disabled={disabled}
                className="w-full rounded-brand border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-accent disabled:opacity-60 sm:w-40"
              />
              <input
                value={d.question}
                onChange={(e) => update(i, { question: e.target.value })}
                placeholder="Question (e.g. Are they SOC 2 compliant?)"
                disabled={disabled}
                className="w-full flex-1 rounded-brand border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-accent disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={disabled}
                aria-label="Remove field"
                className="shrink-0 rounded-brand border border-line px-2 py-1.5 font-mono text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                ✕
              </button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addRow}
              disabled={disabled || defs.length >= MAX_FIELDS}
              className="rounded-brand border border-line px-2.5 py-1 font-mono text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Add field
            </button>
            <span className="font-mono text-[11px] text-muted/60">
              {defs.length}/{MAX_FIELDS}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
