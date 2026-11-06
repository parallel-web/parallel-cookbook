/**
 * Stage 2 of a sheet: one Task run per promise rebuilds that promise's history.
 *
 * The sheet run (stage 1) picks the five promises and drafts a history for all
 * of them at once. A fact-check of that draft found its quotes sound but its
 * histories incomplete (about 1.3 important statements missing per promise),
 * some stances judged loosely, and some outcome figures computed rather than
 * quoted. A run focused on one promise fixes those in the spec itself:
 *   - every call from the first statement on, with not_mentioned where it went unaddressed
 *   - each stance judged against the previous statement in the list
 *   - the document type, so an earnings release is not labelled a call
 *   - outcome figures only as a source states them
 * The draft statements go in as candidates to verify, not as answers.
 */
import type { Company, SheetData } from "../lib/types";
import { OUTCOME_DESCRIPTION, OUTCOME_STATUSES, STANCES } from "./spec";

export const TRAIL_SPEC_KEY = "trail@1";
export const TRAIL_PROCESSOR = "ultra4x";

export const SOURCE_TYPES = [
  "earnings_call",
  "earnings_release",
  "prepared_remarks",
  "shareholder_letter",
  "investor_day",
  "sec_filing",
  "press_release",
  "other",
] as const;

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string", description: "Legal name of the company." },
    ticker: { type: "string", description: "Primary listing ticker." },
    company_website: { type: "string", description: "Company website domain." },
    as_of_date: { type: "string", description: "Research date, YYYY-MM-DD. Ignore anything published after it." },
    window_start: { type: "string", description: "Earliest date to consider, YYYY-MM-DD." },
    promise_id: { type: "string", description: "Id of the promise, e.g. P3." },
    promise: { type: "string", description: "The commitment: label, what management committed to, and the deadline." },
    candidate_statements: {
      type: "string",
      description:
        "Statements from a first research pass, one per line: date | call | stance | quote or summary. Verify each against " +
        "its source: keep it, correct its date, document or stance, or drop it.",
    },
  },
  required: ["company_name", "ticker", "company_website", "as_of_date", "window_start", "promise_id", "promise", "candidate_statements"],
  additionalProperties: false,
} as const;

export const STANCE_DESCRIPTION =
  "How this statement treats the promise compared with the previous entry in this list. stated: the first time it was made. " +
  "reaffirmed: repeated with the same target. on_track: progress reported as on plan. ahead: ahead of plan. raised: the " +
  "target itself was made larger or more ambitious than in the previous entry. lowered: the target was made smaller. " +
  "softened: wording weakened without a new number or date. revised: the date or target changed in another way, such as " +
  "pushed out. declared_done: management said it was achieved. dropped: management abandoned or withdrew it. " +
  "not_mentioned: an earnings call where it was still pending but went unaddressed. Use raised, lowered, softened, revised " +
  "or dropped only when the target itself changed versus the previous entry.";

export const TRAIL_OUTPUT_SCHEMA = {
  type: "object",
  description:
    "The complete, verified history of one promise a public company made on its earnings calls, and what happened to it. " +
    "Use the company's own transcripts, prepared remarks, earnings releases, shareholder letters and SEC filings first; " +
    "third-party transcripts only when the company publishes none.",
  properties: {
    statements: {
      type: "array",
      description:
        "Every statement about this promise from the first time it was made to as_of_date, oldest first: one entry for each " +
        "quarterly earnings call while it was pending (not_mentioned when it went unaddressed), plus any company release, " +
        "filing or investor event that changed, delivered or dropped it. Date each statement to the document where it was " +
        "actually said or written, and check every quote against that document. Statements by named company executives " +
        "or the company itself only.",
      items: {
        type: "object",
        properties: {
          promise_id: { type: "string", description: "The promise_id from the input." },
          date: { type: "string", description: "Date of the call or document, YYYY-MM-DD." },
          call: {
            type: "string",
            description: "Name of the call or document in the company's own fiscal naming, e.g. 'Q2 FY2025 earnings call' or 'Q2 FY2025 earnings release'.",
          },
          source_type: { type: "string", enum: [...SOURCE_TYPES], description: "What kind of document the statement comes from." },
          speaker: {
            type: ["string", "null"],
            description: "Name and title of the executive who said it, e.g. 'Amy Hood, CFO'. Null for a document without a named speaker.",
          },
          stance: { type: "string", enum: [...STANCES], description: STANCE_DESCRIPTION },
          quote: {
            type: ["string", "null"],
            description:
              "The sentence as spoken or written, copied character for character from that document, at most 60 words. No " +
              "ellipses, no paraphrase. Null if the exact wording could not be found or the stance is not_mentioned.",
          },
          summary: { type: "string", description: "What was said about the promise, at most 25 words, keeping every figure and date." },
        },
        required: ["promise_id", "date", "call", "source_type", "speaker", "stance", "quote", "summary"],
        additionalProperties: false,
      },
    },
    outcome_status: { type: "string", enum: [...OUTCOME_STATUSES], description: OUTCOME_DESCRIPTION },
    outcome_summary: {
      type: "string",
      description:
        "What actually happened by as_of_date, at most 30 words. Every figure and date must appear in a cited source as " +
        "written there; do not calculate new figures.",
    },
    outcome_date: { type: ["string", "null"], description: "Date the outcome was reported, YYYY-MM-DD, or null if still pending." },
  },
  required: ["statements", "outcome_status", "outcome_summary", "outcome_date"],
  additionalProperties: false,
} as const;

export function trailRequest(company: Company, sheet: SheetData, pid: string, asOf: string, processor: string = TRAIL_PROCESSOR) {
  const p = sheet.promises.find((x) => x.id === pid);
  if (!p) throw new Error(`${company.ticker} has no ${pid}`);
  const draft = sheet.statements.filter((s) => s.promiseId === pid);
  return {
    processor,
    input: {
      company_name: company.name,
      ticker: company.ticker,
      company_website: company.website,
      as_of_date: asOf,
      window_start: sheet.windowStart,
      promise_id: pid,
      promise: `${p.label}: ${p.commitment} Deadline: ${p.deadline ?? "none given"}. First stated ${p.firstStated}.`,
      candidate_statements: draft.map((s) => [s.date, s.call, s.stance, s.verbatim?.text ?? s.summary].join(" | ")).join("\n"),
    },
    task_spec: {
      input_schema: { type: "json" as const, json_schema: INPUT_SCHEMA as unknown as Record<string, unknown> },
      output_schema: { type: "json" as const, json_schema: TRAIL_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
    },
    metadata: { app: "said-and-done", spec: TRAIL_SPEC_KEY, ticker: company.ticker, promise: pid },
    enable_events: false,
  };
}
