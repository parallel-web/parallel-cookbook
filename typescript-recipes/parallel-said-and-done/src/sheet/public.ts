/**
 * The published copy of a sheet: what data/ holds and the pages read.
 *
 * The pipeline keeps the full sheet in output/sheets/, with the run, group,
 * Search and Extract IDs it needs to chain update runs and replay fills. The
 * published copy drops those IDs and keeps everything a reader sees: which
 * spec and processor made each part, when, and the sources behind every line.
 */
import type { SheetData } from "../lib/types";

/** Parallel request IDs. None may appear in a published sheet; tests/public.test.ts checks data/. */
export const REQUEST_ID = /\b(?:trun|srun|tgrp|search|extract|monevt|mon|evt|interaction)_[a-z0-9]{12,}\b/i;

function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const out = { ...value };
  for (const k of keys) delete out[k];
  return out;
}

export function publicSheet(sheet: SheetData): SheetData {
  return {
    ...sheet,
    promises: sheet.promises.map((p) => ({
      ...omit(p, "addedBy"),
      ...(p.factCheck ? { factCheck: omit(p.factCheck, "runId") } : {}),
      ...(p.resolved ? { resolved: omit(p.resolved, "runId") } : {}),
    })),
    statements: sheet.statements.map((s) => {
      const b = s.verbatim?.backing;
      return {
        ...omit(s, "runId"),
        verbatim: s.verbatim && {
          ...s.verbatim,
          backing: {
            ...omit(s.verbatim.backing, "search", "extract"),
            ...(b?.search ? { search: omit(b.search, "id") } : {}),
            ...(b?.extract ? { extract: omit(b.extract, "id") } : {}),
          },
        },
      };
    }),
    runs: sheet.runs.map((r) => omit(r, "runId", "interactionId", "taskGroupId", "previousInteractionId")),
    fills: { filled: sheet.fills.filled },
    images: {
      logo: sheet.images.logo && omit(sheet.images.logo, "searchId"),
      photo: sheet.images.photo && omit(sheet.images.photo, "searchId"),
    },
  };
}
