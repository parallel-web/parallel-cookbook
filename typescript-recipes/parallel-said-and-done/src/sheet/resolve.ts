/**
 * Resolving a disputed outcome. When most independent fact-checks disagree
 * with a promise's outcome, a flag on the page does not help the reader; the
 * outcome needs to be right. One deep Task run gets the whole case (the
 * history, the outcome as published, and what each check found and why),
 * re-researches it, and returns the outcome the sheet then publishes, with
 * citations. A final fact-check confirms it.
 */
import type { Company, SheetData } from "../lib/types";
import type { StoredRun } from "../parallel/task";
import type { CheckOut } from "./check";
import { OUTCOME_DESCRIPTION, OUTCOME_STATUSES } from "./spec";

export const RESOLVE_SPEC_KEY = "resolve@1";
export const RESOLVE_PROCESSOR = "ultra4x";

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string" },
    ticker: { type: "string" },
    company_website: { type: "string" },
    as_of_date: { type: "string" },
    promise: { type: "string", description: "The commitment: label, what was committed, deadline." },
    history: { type: "string", description: "The promise's statements, oldest first: date | call | stance | quote or summary." },
    published_outcome: { type: "string", description: "The outcome as currently published: status and summary." },
    fact_check_findings: { type: "string", description: "What each independent fact-check concluded about the outcome, and the errors it found." },
  },
  required: ["company_name", "ticker", "company_website", "as_of_date", "promise", "history", "published_outcome", "fact_check_findings"],
  additionalProperties: false,
} as const;

const OUTPUT_SCHEMA = {
  type: "object",
  description:
    "Settle the outcome of one promise a public company made on its earnings calls, where the published outcome and " +
    "independent fact-checks disagree. Research the company's own transcripts, releases and SEC filings up to " +
    "as_of_date. Weigh both positions against the sources, not against each other, and decide.",
  properties: {
    outcome_status: { type: "string", enum: [...OUTCOME_STATUSES], description: OUTCOME_DESCRIPTION },
    outcome_summary: {
      type: "string",
      description:
        "What actually happened by as_of_date, at most 30 words. Every figure and date must appear in a cited source as " +
        "written there; do not calculate new figures.",
    },
    outcome_date: { type: ["string", "null"], description: "Date the outcome was reported, YYYY-MM-DD, or null if still pending." },
    reason: { type: "string", description: "Why this status, in one sentence naming the deciding source." },
  },
  required: ["outcome_status", "outcome_summary", "outcome_date", "reason"],
  additionalProperties: false,
} as const;

export interface ResolveOut {
  outcome_status: (typeof OUTCOME_STATUSES)[number];
  outcome_summary: string;
  outcome_date: string | null;
  reason: string;
}

export function resolveRequest(company: Company, sheet: SheetData, pid: string, checks: StoredRun[]) {
  const p = sheet.promises.find((x) => x.id === pid);
  if (!p) throw new Error(`${company.ticker} has no ${pid}`);
  const history = sheet.statements.filter((s) => s.promiseId === pid);
  const findings = checks.map((c, i) => {
    const out = (c.result?.output as { content?: CheckOut } | undefined)?.content;
    if (!out) return "";
    const errors = out.outcome_summary_errors.length ? ` Errors found: ${out.outcome_summary_errors.join(" ")}` : "";
    return `Check ${i + 1}: verdict ${out.outcome_verdict}; its own assessment: ${out.outcome_status}.${errors}`;
  });
  return {
    processor: RESOLVE_PROCESSOR,
    input: {
      company_name: company.name,
      ticker: company.ticker,
      company_website: company.website,
      as_of_date: sheet.asOf,
      promise: `${p.label}: ${p.commitment} Deadline: ${p.deadline ?? "none given"}.`,
      history: history.map((s) => [s.date, s.call, s.stance, s.verbatim?.text ?? s.summary].join(" | ")).join("\n"),
      published_outcome: `${p.status}: ${p.outcomeSummary}`,
      fact_check_findings: findings.filter(Boolean).join("\n"),
    },
    task_spec: {
      input_schema: { type: "json" as const, json_schema: INPUT_SCHEMA as unknown as Record<string, unknown> },
      output_schema: { type: "json" as const, json_schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> },
    },
    metadata: { app: "said-and-done", spec: RESOLVE_SPEC_KEY, ticker: company.ticker, promise: pid },
    enable_events: false,
  };
}
