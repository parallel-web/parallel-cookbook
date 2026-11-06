/**
 * Keeping a sheet current: the Monitor, Search, Extract and update Task requests.
 *
 * - MONITOR: one event_stream monitor per company reports, as structured
 *   events, earnings calls held or scheduled and company announcements that
 *   move one of the tracked promises.
 * - Call day: Search finds the call's transcript; Extract reads it in full.
 *   For an announcement, Extract reads the page the monitor cited.
 * - UPDATE: one Task run per new call or announcement, chained to the
 *   company's sheet run with `previous_interaction_id`, appends its statements
 *   and any new promises.
 *
 *   update@2  one earnings call
 *   update@3  an earnings call or a company statement between calls
 *   update@4  the delivered_late outcome
 *   monitor@1 earnings calls only
 *   monitor@2 earnings calls, plus announcements about the tracked promises
 */
import type { Company, SheetData } from "../lib/types";
import { OUTCOME_DESCRIPTION, OUTCOME_STATUSES, nextCallFields, statementItem } from "../sheet/spec";

export const UPDATE_SPEC_KEY = "update@4";
export const UPDATE_PROCESSOR = "ultra";

export const MONITOR_SPEC_KEY = "monitor@2";
export const MONITOR_PROCESSOR = "lite";
export const MONITOR_FREQUENCY = "6h";

export const UPDATE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string", description: "Legal name of the company." },
    ticker: { type: "string", description: "Primary listing ticker." },
    company_website: { type: "string", description: "Company website domain." },
    call_date: { type: "string", description: "Date of the new earnings call or company statement, YYYY-MM-DD." },
    fiscal_quarter: {
      type: "string",
      description: "Fiscal quarter the call reported; for a company statement between calls, its title, e.g. 'Press release'.",
    },
    source_type: {
      type: "string",
      enum: ["earnings_call", "company_statement"],
      description:
        "earnings_call: a quarterly earnings call. company_statement: a press release, SEC filing, investor day or " +
        "executive statement between calls.",
    },
    transcript_url: {
      type: "string",
      description: "Transcript or prepared remarks for the call, or the statement itself, found with the Search or Monitor API. May be empty.",
    },
    tracked_promises: {
      type: "string",
      description: "The promises already tracked, one per line: promise_id | label | commitment | current status.",
    },
  },
  required: ["company_name", "ticker", "company_website", "call_date", "fiscal_quarter", "source_type", "transcript_url", "tracked_promises"],
  additionalProperties: false,
} as const;

export const UPDATE_OUTPUT_SCHEMA = {
  type: "object",
  description:
    "What the company's executives said on call_date about each tracked promise, the status of each promise after " +
    "it, and any new promises made for the first time. The source is the earnings call held that day, or for a " +
    "company_statement the announcement, filing or statement published that day. Read the transcript, prepared " +
    "remarks or statement; start from transcript_url when it is given. statements and promise_updates use only the " +
    "promise_ids in tracked_promises.",
  properties: {
    call_date: { type: "string", description: "Date of the call or statement that was read, YYYY-MM-DD." },
    fiscal_quarter: { type: "string", description: "Fiscal quarter that call reported in the company's naming, or the statement's title." },
    transcript_url: { type: "string", description: "URL of the transcript, prepared remarks or statement that was read." },
    statements: {
      type: "array",
      description:
        "Exactly one statement per tracked promise from this call or statement. Use not_mentioned when it was not addressed.",
      items: statementItem,
    },
    promise_updates: {
      type: "array",
      description: "Exactly one entry per tracked promise with its status after this call or statement.",
      items: {
        type: "object",
        properties: {
          promise_id: { type: "string", description: "A promise_id from tracked_promises." },
          outcome_status: { type: "string", enum: [...OUTCOME_STATUSES], description: OUTCOME_DESCRIPTION },
          outcome_summary: {
            type: "string",
            description: "What has happened so far, at most 30 words, with figures and dates.",
          },
        },
        required: ["promise_id", "outcome_status", "outcome_summary"],
        additionalProperties: false,
      },
    },
    new_promises: {
      type: "array",
      description:
        "Promises made for the first time in this call or statement that are not among tracked_promises: specific, checkable " +
        "forward-looking commitments by the CEO or CFO, such as a target number, a date, a launch, a deal closing, a " +
        "cost program or a capital return. At most three, most consequential first. Exclude one-off quarterly " +
        "guidance and restatements of tracked promises. Empty if there are none.",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Name of the promise in at most six words, e.g. 'Model e breakeven by 2029'." },
          commitment: { type: "string", description: "What management committed to, with the target and deadline, at most 30 words." },
          deadline: {
            type: ["string", "null"],
            description: "Target date or period as stated, e.g. '2029' or 'end of 2027'. Null if none was given.",
          },
          speaker: {
            type: ["string", "null"],
            description: "Name and title of the executive who made it, e.g. 'Jim Farley, CEO'. Null if not attributable.",
          },
          quote: {
            type: ["string", "null"],
            description:
              "The sentence that states the promise, copied character for character from the transcript or prepared " +
              "remarks, at most 60 words. No ellipses or paraphrase. Null if the exact wording could not be found.",
          },
          summary: {
            type: "string",
            description: "What was promised on this call, at most 25 words, keeping every figure and date.",
          },
        },
        required: ["label", "commitment", "deadline", "speaker", "quote", "summary"],
        additionalProperties: false,
      },
    },
    ...nextCallFields,
  },
  required: [
    "call_date",
    "fiscal_quarter",
    "transcript_url",
    "statements",
    "promise_updates",
    "new_promises",
    "next_call_date",
    "next_call_time",
    "next_call_quarter",
  ],
  additionalProperties: false,
} as const;

/**
 * Structured monitor events. The pipeline acts on earnings_call_held,
 * earnings_call_scheduled and promise_update; routing is in src/updates/monitor-events.ts.
 */
export const MONITOR_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    event_kind: {
      type: "string",
      enum: ["earnings_call_held", "earnings_call_scheduled", "promise_update", "other"],
      description:
        "earnings_call_held: the company reported quarterly results and held its earnings call. " +
        "earnings_call_scheduled: the company announced the date of an upcoming call. " +
        "promise_update: outside an earnings call, the company itself announced, filed or stated something that " +
        "delivers, changes, delays or abandons one of the tracked commitments in the query. other: anything else.",
    },
    call_date: {
      type: ["string", "null"],
      description: "Date of the call, or of the announcement for promise_update, YYYY-MM-DD. Null for other.",
    },
    fiscal_quarter: { type: ["string", "null"], description: "Fiscal quarter the call reports, in the company's naming. Null for promise_update." },
    transcript_url: {
      type: ["string", "null"],
      description: "URL of the call transcript or prepared remarks if one is published. Null otherwise.",
    },
    results_release_url: {
      type: ["string", "null"],
      description: "URL of the company's earnings press release for that quarter. Null otherwise.",
    },
    promise_id: {
      type: ["string", "null"],
      description: "For promise_update: the tracked commitment's id from the query, e.g. P3. Null otherwise.",
    },
    source_url: {
      type: ["string", "null"],
      description:
        "For promise_update: URL of the company's own press release, SEC filing, investor presentation or published " +
        "executive statement. Null otherwise.",
    },
    source_title: { type: ["string", "null"], description: "For promise_update: title of that source, e.g. 'Form 8-K'. Null otherwise." },
    summary: { type: "string", description: "What happened, at most 25 words, keeping every figure and date." },
  },
  required: [
    "event_kind",
    "call_date",
    "fiscal_quarter",
    "transcript_url",
    "results_release_url",
    "promise_id",
    "source_url",
    "source_title",
    "summary",
  ],
  additionalProperties: false,
} as const;

/** What an update run reads: an earnings call, or a company statement a monitor reported between calls. */
export interface UpdateSource {
  date: string;
  /** Fiscal quarter for a call; the statement's title for an event. */
  quarter: string;
  transcriptUrl: string | null;
  kind?: "call" | "event";
}

export function updateTaskSpec() {
  return {
    input_schema: { type: "json" as const, json_schema: UPDATE_INPUT_SCHEMA as unknown as Record<string, unknown> },
    output_schema: { type: "json" as const, json_schema: UPDATE_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
  };
}

export function updateInput(
  company: Company,
  sheet: SheetData,
  call: UpdateSource,
) {
  return {
    company_name: company.name,
    ticker: company.ticker,
    company_website: company.website,
    call_date: call.date,
    fiscal_quarter: call.quarter,
    source_type: call.kind === "event" ? "company_statement" : "earnings_call",
    transcript_url: call.transcriptUrl ?? "",
    tracked_promises: sheet.promises
      .map((p) => [p.id, p.label, p.commitment, p.status].join(" | "))
      .join("\n"),
  };
}

/**
 * The update run for one new call. `previous_interaction_id` chains it to the
 * run that built the sheet, so the Task starts from the tracked register.
 */
export function updateRunRequest(
  company: Company,
  sheet: SheetData,
  call: UpdateSource,
  processor: string = UPDATE_PROCESSOR,
) {
  const last = [...sheet.runs].reverse().find(r => r.kind === "update" || r.kind === "sheet");
  if (!last?.interactionId) throw new Error(`Run pnpm sheet ${company.ticker} before updating the recorded snapshot`);
  return {
    processor,
    input: updateInput(company, sheet, call),
    task_spec: updateTaskSpec(),
    previous_interaction_id: last.interactionId,
    metadata: { app: "said-and-done", spec: UPDATE_SPEC_KEY, ticker: company.ticker, call_date: call.date },
    enable_events: false,
  };
}

/** The monitor's query names the tracked promises, so it can report announcements that move them. */
export function monitorQuery(company: Company, sheet: Pick<SheetData, "promises"> | null) {
  const calls = `${company.name} (${company.ticker}) quarterly earnings results and earnings conference calls`;
  const live = (sheet?.promises ?? []).filter((p) => p.k !== "done" && p.k !== "drop");
  if (!live.length) return calls;
  return `${calls}, and company announcements, SEC filings or executive statements after a call that deliver, change, delay or abandon (not merely restate or recap) these tracked commitments: ${live.map((p) => `${p.id} ${p.label}`).join("; ")}`;
}

/** Search request used on call day to find the call's transcript. */
export function callDaySearchRequest(company: Company, call: { date: string; quarter: string }) {
  const day = new Date(`${call.date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    objective:
      `Find the transcript or prepared remarks of ${company.name}'s ${call.quarter} earnings call held ${day}, ` +
      `preferably on the company's own investor relations site.`,
    search_queries: [
      `${company.short} ${call.quarter} earnings call transcript`,
      `${company.name} ${call.quarter} earnings call ${day}`,
      `${company.ticker} ${call.quarter} prepared remarks`,
    ],
    mode: "advanced" as const,
    advanced_settings: { source_policy: { after_date: shiftDate(call.date, -1) } },
  };
}

/** Extract request used on call day, or on an announcement: excerpts aimed at every promise still being tracked. */
export function callDayExtractRequest(sheet: SheetData, url: string, callDate: string, kind: "call" | "event" = "call") {
  const day = new Date(`${callDate}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    urls: [url],
    objective: `What ${sheet.short} said ${kind === "call" ? `on the ${day} call` : `in its ${day} announcement`} about: ${sheet.promises.map((p) => p.label).join("; ")}.`,
    search_queries: sheet.promises.slice(0, 5).map((p) => p.label.slice(0, 200)),
    // Excerpts follow the objective; the full transcript lets every promise be matched sentence by sentence.
    advanced_settings: { excerpt_settings: { max_chars_per_result: 12000 }, full_content: { max_chars_per_result: 250000 } },
  };
}

export function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
