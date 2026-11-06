/**
 * Stage 3 of a sheet: an independent fact-check of each promise as it will be
 * published. One Task run per promise, deliberately not chained to the runs
 * that produced the history, verifies the outcome, each statement's date and
 * document, each stance, and each figure in the outcome summary.
 *
 * The build acts on two verdicts: a statement the check places on a different
 * date is held back, and a disputed outcome is shown as disputed. Everything
 * else is recorded with the sheet as provenance.
 */
import type { Company, SheetData } from "../lib/types";
import { OUTCOME_DESCRIPTION, OUTCOME_STATUSES, STANCES } from "./spec";
import { STANCE_DESCRIPTION } from "./trail";

/**
 * check@1  verdicts without the sheet's definitions; most disputes were about
 *          what "partly delivered" or "revised" means, not about facts
 * check@2  the same outcome and stance definitions the sheet uses
 * check@3  the delivered_late outcome
 */
export const CHECK_SPEC_KEY = "check@3";
export const CHECK_PROCESSOR = "ultra";

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string" },
    ticker: { type: "string" },
    as_of_date: { type: "string" },
    promise: { type: "string", description: "The commitment being tracked: label, what was committed, deadline." },
    claimed_outcome: { type: "string", description: "The claimed status and summary to check." },
    claimed_statements: { type: "string", description: "One per line: id | date | call | stance | quote or summary." },
  },
  required: ["company_name", "ticker", "as_of_date", "promise", "claimed_outcome", "claimed_statements"],
  additionalProperties: false,
} as const;

export const CHECK_OUTPUT_SCHEMA = {
  type: "object",
  description:
    "An independent check of a research claim about a public company's earnings-call commitment, using the company's own " +
    "transcripts, prepared remarks, releases and SEC filings. Judge each claim against the sources, not against the claim.",
  properties: {
    outcome_status: {
      type: "string",
      enum: [...OUTCOME_STATUSES],
      description: `Your own assessment of the promise's status as of as_of_date, using these definitions. ${OUTCOME_DESCRIPTION}`,
    },
    outcome_verdict: { type: "string", enum: ["correct", "incorrect", "unclear"], description: "Whether claimed_outcome's status matches the evidence." },
    outcome_summary_errors: {
      type: "array",
      description:
        "Each figure, date or fact in claimed_outcome's summary that the sources contradict or do not support, with the correct value. Empty if all are supported.",
      items: { type: "string" },
    },
    statements: {
      type: "array",
      description: "One entry per line of claimed_statements, in the same order.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "The statement id from claimed_statements, e.g. S3." },
          date_verdict: {
            type: "string",
            enum: ["correct", "wrong_call", "unverifiable"],
            description:
              "correct: the quote was said or written on the claimed date. wrong_call: it comes from a call or document on a different date. unverifiable: no source found.",
          },
          correct_date: { type: ["string", "null"], description: "If wrong_call, the date of the call or document where it was said, YYYY-MM-DD. Null otherwise." },
          stance_verdict: { type: "string", enum: ["agree", "disagree", "unclear"], description: "Whether the claimed stance fits what was said, given earlier statements." },
          correct_stance: {
            type: ["string", "null"],
            enum: [...STANCES, null],
            description: `If disagree, the stance that fits, using these definitions. ${STANCE_DESCRIPTION} Null otherwise.`,
          },
        },
        required: ["id", "date_verdict", "correct_date", "stance_verdict", "correct_stance"],
        additionalProperties: false,
      },
    },
    missing_statements: {
      type: "array",
      description:
        "Up to three earnings-call statements about this promise that claimed_statements leaves out and that change the picture, e.g. a revision or the delivery. Empty if none.",
      items: {
        type: "object",
        properties: { date: { type: "string" }, call: { type: "string" }, what_was_said: { type: "string" } },
        required: ["date", "call", "what_was_said"],
        additionalProperties: false,
      },
    },
  },
  required: ["outcome_status", "outcome_verdict", "outcome_summary_errors", "statements", "missing_statements"],
  additionalProperties: false,
} as const;

/** The claims a check reads: the promise as the sheet would publish it. */
export function checkRequest(company: Company, sheet: SheetData, pid: string, processor: string = CHECK_PROCESSOR) {
  const p = sheet.promises.find((x) => x.id === pid);
  if (!p) throw new Error(`${company.ticker} has no ${pid}`);
  const said = sheet.statements.filter((s) => s.promiseId === pid && s.stance !== "not_mentioned");
  return {
    processor,
    input: {
      company_name: company.name,
      ticker: company.ticker,
      as_of_date: sheet.asOf,
      promise: `${p.label}: ${p.commitment} Deadline: ${p.deadline ?? "none given"}.`,
      claimed_outcome: `${p.status}: ${p.outcomeSummary}`,
      claimed_statements: said.map((s, i) => [`S${i + 1}`, s.date, s.call, s.stance, s.verbatim?.text ?? s.summary].join(" | ")).join("\n"),
    },
    task_spec: {
      input_schema: { type: "json" as const, json_schema: INPUT_SCHEMA as unknown as Record<string, unknown> },
      output_schema: { type: "json" as const, json_schema: CHECK_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
    },
    metadata: { app: "said-and-done", spec: CHECK_SPEC_KEY, ticker: company.ticker, promise: pid },
    enable_events: false,
  };
}

export interface CheckOut {
  outcome_status: string;
  outcome_verdict: "correct" | "incorrect" | "unclear";
  outcome_summary_errors: string[];
  statements: { id: string; date_verdict: string; correct_date: string | null; stance_verdict: string; correct_stance: string | null }[];
  missing_statements: { date: string; call: string; what_was_said: string }[];
}

/** Dates the check says a claimed statement was really made on, keyed by the claimed date. */
export function misdated(input: { claimed_statements: string }, out: CheckOut): Map<string, string> {
  const claimed = input.claimed_statements.split("\n").map((l) => l.split(" | "));
  const moved = new Map<string, string>();
  for (const s of out.statements) {
    if (s.date_verdict !== "wrong_call" || !s.correct_date) continue;
    const date = claimed.find((c) => c[0] === s.id)?.[1];
    if (!date) continue;
    const days = Math.abs(new Date(`${date}T12:00:00Z`).getTime() - new Date(`${s.correct_date}T12:00:00Z`).getTime()) / 86_400_000;
    // Same day, different document (the release rather than the call) keeps its date.
    if (days > 3) moved.set(date, s.correct_date);
  }
  return moved;
}
