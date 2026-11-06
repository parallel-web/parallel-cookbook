/**
 * Step 1 of making a sheet: the Task API request.
 *
 * One Task run per company returns the whole tear sheet: the promise register
 * and every dated earnings-call statement about each promise. The output
 * schema below is the sheet template; each section of the sheet reads one
 * field, and the run's basis gives citations per statement (`statements.N`).
 *
 * The spec key is versioned. Change it whenever a schema or rule changes so
 * stored outputs stay tied to the spec that produced them.
 *   sheet@1  five promises investors tracked most closely
 *   sheet@2  at least three of the five still live (open, revised or addressed
 *            in the last 18 months), so new calls have something to update
 *   sheet@3  outcome delivered_late: done in full after the original deadline,
 *            no longer folded into missed (shared by every spec below)
 */
import type { Company } from "../lib/types";

export const SHEET_SPEC_KEY = "sheet@3";

/** ultra2x gave the most verbatim-backed statements per dollar in the comparison in README.md. */
export const SHEET_PROCESSOR = "ultra2x";

export const OUTCOME_STATUSES = [
  "delivered",
  "delivered_late",
  "exceeded",
  "partly_delivered",
  "revised",
  "open",
  "missed",
  "dropped",
] as const;

export const STANCES = [
  "stated",
  "reaffirmed",
  "on_track",
  "ahead",
  "raised",
  "lowered",
  "softened",
  "revised",
  "declared_done",
  "dropped",
  "not_mentioned",
] as const;

export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];
export type Stance = (typeof STANCES)[number];

export const OUTCOME_DESCRIPTION =
  "Status as of as_of_date. delivered: done as promised, by the deadline. delivered_late: done in full, but " +
  "after the original deadline; outcome_date is when it was done. exceeded: done and beat the stated target. " +
  "partly_delivered: some of the target met, the rest missed or abandoned. revised: management changed the " +
  "target or date and it is still pending. open: still pending with the original target. missed: the deadline " +
  "passed and the target was not met (a target met in full only after the deadline is delivered_late, not " +
  "missed). dropped: management abandoned it, or stopped mentioning it while it was unmet.";

export const STANCE_DESCRIPTION =
  "How this statement treats the promise. stated: first time it was made. reaffirmed: repeated unchanged. " +
  "on_track: progress reported as on plan. ahead: ahead of plan. raised: target made larger or more ambitious. " +
  "lowered: target made smaller. softened: wording weakened without a new number or date. revised: date or " +
  "target changed in another way, such as pushed out. declared_done: management said it was achieved. dropped: " +
  "management abandoned or withdrew it. not_mentioned: a call where it was still pending but management did not " +
  "address it.";

/** The statement item is shared with the update spec so updates merge into a sheet unchanged. */
export const statementItem = {
  type: "object",
  properties: {
    promise_id: { type: "string", description: "The promise_id this statement is about." },
    date: { type: "string", description: "Date of the call or document, YYYY-MM-DD." },
    call: {
      type: "string",
      description:
        "Name of the call or document in the company's own fiscal naming, e.g. 'Q2 FY2025 earnings call' or 'Q4 2023 shareholder letter'.",
    },
    speaker: {
      type: ["string", "null"],
      description: "Name and title of the executive who said it, e.g. 'Amy Hood, CFO'. Null if not attributable.",
    },
    stance: { type: "string", enum: [...STANCES], description: STANCE_DESCRIPTION },
    quote: {
      type: ["string", "null"],
      description:
        "The sentence as spoken or written, copied character for character from the transcript, prepared remarks or " +
        "letter, at most 60 words. No ellipses, no paraphrase, no added words. Null if the exact wording could not be " +
        "found or the stance is not_mentioned.",
    },
    summary: {
      type: "string",
      description: "What was said about the promise in this statement, at most 25 words, keeping every figure and date.",
    },
  },
  required: ["promise_id", "date", "call", "speaker", "stance", "quote", "summary"],
  additionalProperties: false,
} as const;

export const nextCallFields = {
  next_call_date: {
    type: ["string", "null"],
    description:
      "Date of the next earnings call after as_of_date, YYYY-MM-DD, only if the company has announced it. Null otherwise.",
  },
  next_call_time: {
    type: ["string", "null"],
    description: "Announced start time of that call with its time zone, e.g. '2:30 PM PT'. Null if not announced.",
  },
  next_call_quarter: {
    type: ["string", "null"],
    description: "Fiscal quarter that call will report, in the company's naming, e.g. 'Q1 FY2027'. Null if unknown.",
  },
} as const;

export const SHEET_INPUT_SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string", description: "Legal name of the company." },
    ticker: { type: "string", description: "Primary listing ticker." },
    company_website: { type: "string", description: "Company website domain." },
    window_start: { type: "string", description: "Earliest call to consider, YYYY-MM-DD." },
    as_of_date: { type: "string", description: "Research date, YYYY-MM-DD. Ignore anything published after it." },
  },
  required: ["company_name", "ticker", "company_website", "window_start", "as_of_date"],
  additionalProperties: false,
} as const;

export const SHEET_OUTPUT_SCHEMA = {
  type: "object",
  description:
    "A promise tear sheet for one public company: the five most consequential forward-looking commitments its " +
    "executives made on earnings calls between window_start and as_of_date, every dated earnings-call statement " +
    "about each one, and what happened. Use the company's own transcripts, prepared remarks, shareholder letters, " +
    "earnings releases and SEC filings first; use third-party transcript sites only when the company does not " +
    "publish its own. Statements must be made by named company executives, never by analysts or journalists.",
  properties: {
    exchange: { type: "string", description: "Primary exchange of the ticker, e.g. NASDAQ or NYSE." },
    fiscal_year_end: { type: "string", description: "Month and day the fiscal year ends, e.g. 'June 30'." },
    investor_relations_url: { type: "string", description: "URL of the company's investor relations home page." },
    latest_call_date: {
      type: "string",
      description: "Date of the most recent earnings call held on or before as_of_date, YYYY-MM-DD.",
    },
    latest_call_quarter: {
      type: "string",
      description: "Fiscal quarter that call reported, in the company's naming, e.g. 'Q1 FY2026' or 'Q3 2026'.",
    },
    ...nextCallFields,
    photo_subject: {
      type: "string",
      description:
        "A photo search phrase of at most 8 words naming the company and the physical site or product most tied to " +
        "these promises, e.g. 'Microsoft Azure datacenter'.",
    },
    promises: {
      type: "array",
      description:
        "Exactly five promises, P1 to P5 in order of first statement date. A promise is a specific, checkable " +
        "forward-looking commitment by the CEO or CFO: a target number, a date, a launch, a deal closing, a cost " +
        "program or a capital return. Pick the five investors are tracking now: at least three of the five must " +
        "still be live at as_of_date, meaning outcome open or revised, or addressed on an earnings call in the 18 " +
        "months before as_of_date. Prefer commitments management addressed on the latest call. Exclude one-off " +
        "quarterly guidance. Each promise needs at least three statements.",
      items: {
        type: "object",
        properties: {
          promise_id: { type: "string", description: "P1 to P5." },
          label: { type: "string", description: "Name of the promise in at most six words, e.g. 'Ease AI capacity constraints'." },
          commitment: {
            type: "string",
            description: "What management committed to when it was first stated, with the target and deadline, at most 30 words.",
          },
          deadline: {
            type: ["string", "null"],
            description: "Target date or period as stated, e.g. 'end of FY2025' or '2026'. Null if none was given.",
          },
          first_stated_date: { type: "string", description: "Date of the call where it was first stated, YYYY-MM-DD." },
          outcome_status: { type: "string", enum: [...OUTCOME_STATUSES], description: OUTCOME_DESCRIPTION },
          outcome_summary: {
            type: "string",
            description: "What actually happened by as_of_date, at most 30 words, with figures and dates.",
          },
        },
        required: [
          "promise_id",
          "label",
          "commitment",
          "deadline",
          "first_stated_date",
          "outcome_status",
          "outcome_summary",
        ],
        additionalProperties: false,
      },
    },
    statements: {
      type: "array",
      description:
        "Every dated earnings-call statement about the five promises, three to eight per promise, one per promise " +
        "per call, oldest first within each promise. Include a not_mentioned entry for a call where a pending " +
        "promise went unaddressed.",
      items: statementItem,
    },
  },
  required: [
    "exchange",
    "fiscal_year_end",
    "investor_relations_url",
    "latest_call_date",
    "latest_call_quarter",
    "next_call_date",
    "next_call_time",
    "next_call_quarter",
    "photo_subject",
    "promises",
    "statements",
  ],
  additionalProperties: false,
} as const;

export function sheetInput(company: Company, windowStart: string, asOf: string) {
  return {
    company_name: company.name,
    ticker: company.ticker,
    company_website: company.website,
    window_start: windowStart,
    as_of_date: asOf,
  };
}

export function sheetTaskSpec() {
  return {
    input_schema: { type: "json" as const, json_schema: SHEET_INPUT_SCHEMA as unknown as Record<string, unknown> },
    output_schema: { type: "json" as const, json_schema: SHEET_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
  };
}

/** The full Task API request for one company's sheet. */
export function sheetRunRequest(company: Company, windowStart: string, asOf: string, processor: string = SHEET_PROCESSOR) {
  return {
    processor,
    input: sheetInput(company, windowStart, asOf),
    task_spec: sheetTaskSpec(),
    metadata: { app: "said-and-done", spec: SHEET_SPEC_KEY, ticker: company.ticker },
    enable_events: false,
  };
}
