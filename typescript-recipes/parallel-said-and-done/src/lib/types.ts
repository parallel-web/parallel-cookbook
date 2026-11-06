/**
 * The data model every page renders. Sheets are built deterministically from
 * stored Parallel responses by src/sheet/build.ts; nothing here is typed by
 * hand except the coverage list in config/companies.json.
 */
import type { OutcomeStatus, Stance } from "../sheet/spec";

export type { OutcomeStatus, Stance };

export interface Company {
  ticker: string;
  name: string;
  short: string;
  website: string;
}

/** Outcome bucket used for marks and counts. */
export type OutcomeKey = "done" | "part" | "rev" | "open" | "miss" | "drop";
/** Stance bucket: s stated, h held, c changed, x not mentioned, d declared done. */
export type StanceKey = "s" | "h" | "c" | "x" | "d";
/** Source tier, from the URL's domain. */
export type SourceTier = "primary" | "transcript" | "press";

export interface Seg {
  t: string;
  /** 1 when the text is a figure, auto-marked by src/lib/text.ts. */
  h: 0 | 1;
}

export interface Citation {
  url: string;
  title: string | null;
  domain: string;
  tier: SourceTier;
}

/** Where a verbatim passage came from. */
export interface Backing {
  via: "task" | "search" | "extract";
  url: string;
  title: string | null;
  domain: string;
  tier: SourceTier;
  /** Search request that found the URL, when Search was used. `id` is kept in output/ only. */
  search?: { id?: string; rank: number; query: string; objective: string };
  /** Extract request that read the page, when Extract was used. `id` is kept in output/ only. */
  extract?: { id?: string; objective: string };
  /** Where the Extract URL came from. */
  urlFrom?: "task-citation" | "search";
}

export interface Verbatim {
  text: string;
  segs: Seg[];
  backing: Backing;
  /** exact: the Task's quote appears in the source text; matched: best overlapping passage. */
  match: "exact" | "matched";
}

export interface Statement {
  id: string;
  promiseId: string;
  date: string;
  call: string;
  speaker: string | null;
  stance: Stance;
  k: StanceKey;
  /** Task output field `summary`. Shown in italics when no verbatim text was captured. */
  summary: string;
  /** Task output field `quote`. Never shown as verbatim unless found in a source. */
  quote: string | null;
  verbatim: Verbatim | null;
  citations: Citation[];
  confidence: string | null;
  /** Which Task run produced this statement. Kept in output/ only; see src/sheet/public.ts. */
  runId?: string;
  /** trail@1: the kind of document it comes from, e.g. earnings_call or earnings_release. */
  sourceType?: string | null;
}

export interface Promise {
  id: string;
  label: string;
  commitment: string;
  deadline: string | null;
  firstStated: string;
  status: OutcomeStatus;
  k: OutcomeKey;
  outcomeSummary: string;
  citations: Citation[];
  confidence: string | null;
  /** trail@1: when the outcome was reported. */
  outcomeDate?: string | null;
  /** check@2: the independent fact-check of this promise as published. */
  factCheck?: FactCheck | null;
  /** resolve@1: set when fact-checks disagreed with the outcome and a deeper run settled it. */
  resolved?: { runId?: string; from: string; reason: string } | null;
  /** Set when an update run added this promise from a later call. */
  addedOn?: string | null;
  /** The update run that added it. Kept in output/ only. */
  addedBy?: string | null;
}

export interface FactCheck {
  /** Kept in output/ only. */
  runId?: string;
  /** Whether the check agrees with the published outcome status. */
  verdict: "correct" | "incorrect" | "unclear";
  /** The status the check found on its own. */
  status: string;
  summaryErrors: string[];
  /** Statements the check placed on a different date; held back from the sheet. */
  held: number;
  /** Statements the check says the history leaves out. */
  missing: { date: string; call: string; what_was_said: string }[];
  /** How many independent checks ran, and how many agree with the verdict. */
  checks?: number;
  agree?: number;
}

export interface SourceRow {
  n: number;
  url: string;
  title: string;
  domain: string;
  tier: SourceTier;
  /** Promise ids this source backs, e.g. "P1 P3". */
  uses: string;
}

export interface GateCheck {
  id: string;
  label: string;
  result: "pass" | "warn" | "fail";
  detail: string;
}

export interface GateReport {
  kind: "sheet" | "update";
  checks: GateCheck[];
  passed: boolean;
}

export interface RunRef {
  /** sheet: stage 1. trail: stage 2, one promise's history. check: stage 3, its fact-check. update: a later call. */
  kind: "sheet" | "update" | "trail" | "check";
  spec: string;
  /** Run, interaction and group IDs are kept in output/ only; data/ drops them (src/sheet/public.ts). */
  runId?: string;
  interactionId?: string;
  processor: string;
  createdAt: string;
  completedAt: string | null;
  taskGroupId?: string | null;
  previousInteractionId?: string | null;
  /** The call an update run read. */
  callDate?: string;
}

export interface FillLog {
  /** Request IDs, kept in output/ only. */
  searches?: { id: string; statementId: string }[];
  extracts?: { id: string; statementId: string }[];
  /** Statements filled verbatim by Search or Extract. */
  filled: number;
}

export interface ImagePick {
  imageUrl: string;
  sourcePageUrl: string;
  title: string | null;
  width: number | null;
  height: number | null;
  /** Kept in output/ only. */
  searchId?: string;
  rank: number;
}

export interface SheetData {
  schema: "said-done.sheet/1";
  ticker: string;
  name: string;
  short: string;
  website: string;
  exchange: string;
  fiscalYearEnd: string;
  irUrl: string;
  asOf: string;
  windowStart: string;
  latestCall: { date: string; quarter: string };
  /** source "monitor": the date came from a monitor's earnings_call_scheduled event, newer than the last Task run. */
  nextCall: { date: string | null; time: string | null; quarter: string | null; source?: "task" | "monitor" };
  photoSubject: string;
  promises: Promise[];
  statements: Statement[];
  sources: SourceRow[];
  focus: string;
  runs: RunRef[];
  fills: FillLog;
  gate: GateReport;
  images: { logo: ImagePick | null; photo: ImagePick | null };
  version: number;
  builtAt: string;
}

export interface PublishedEntry {
  ticker: string;
  version: number;
  publishedAt: string;
  trigger: "initial" | "rerun" | "monitor" | "manual" | "schedule";
  /** The call this version added, for monitor-triggered versions. */
  callDate: string | null;
  monitorEventId: string | null;
}

export interface CoverageIndex {
  schema: "said-done.index/1";
  windowStart: string;
  updatedAt: string;
  order: string[];
  published: PublishedEntry[];
  /** Coverage-wide run facts for the Run panel. */
  build: { taskGroupId: string | null; processor: string; spec: string; createdAt: string };
}

export interface CallDayResult {
  rank: number;
  title: string;
  url: string;
  domain: string;
  date: string | null;
  own: boolean;
  transcript: boolean;
  picked: boolean;
}

export interface CallDayPassage {
  text: string;
  segs: Seg[];
  promiseId: string | null;
  hits: string[];
  /** The Task statement for the same promise and call, if the update run made one. */
  task: { statementId: string; stance: Stance; k: StanceKey; segs: Seg[]; verbatim: boolean; domain: string | null } | null;
  agree: "same" | "part" | "diff" | "none";
  shared: string[];
}

export interface CallDayRecord {
  schema: "said-done.callday/1";
  ticker: string;
  callDate: string;
  /** Fiscal quarter for a call; the announcement's title for an event. */
  quarter: string;
  /** call: an earnings call found with Search. event: an announcement a monitor reported between calls. */
  kind?: "call" | "event";
  createdAt: string;
  status: "waiting_transcript" | "extracted" | "updating" | "published" | "held";
  trigger: {
    /** schedule: the sheet's next-call date passed with no "held" event, so the pipeline ran on the date alone. */
    kind: "monitor" | "manual" | "schedule";
    monitorId: string | null;
    eventId: string | null;
    eventGroupId: string | null;
    eventDate: string | null;
    content: Record<string, unknown> | null;
    citations: Citation[];
  };
  search: {
    id: string;
    request: Record<string, unknown>;
    results: CallDayResult[];
    pickRule: string;
  } | null;
  extract: { id: string; request: Record<string, unknown>; url: string } | null;
  passages: CallDayPassage[];
  coverage: { promiseId: string; n: number }[];
  update: { runId: string; status: string; processor: string } | null;
  gate: GateReport | null;
  sheetVersion: number | null;
}
