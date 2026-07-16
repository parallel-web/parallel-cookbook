// Helpers for custom research questions (Clay-style ad-hoc columns in bulk
// mode, and the ask-bar in single mode). Deliberately NOT persisted anywhere —
// questions are per-session; a page refresh starts clean.
import type { CustomFieldDef } from "../types";

// A fresh, empty editor row.
export function blankDef(): CustomFieldDef {
  return { label: "", question: "" };
}

// Keep only rows with an actual question — what we send to the API.
export function usableDefs(defs: CustomFieldDef[]): CustomFieldDef[] {
  return defs
    .map((d) => ({ ...d, label: d.label.trim(), question: d.question.trim() }))
    .filter((d) => d.question.length > 0)
    .map((d) => ({ ...d, label: d.label || d.question.slice(0, 40) }));
}
