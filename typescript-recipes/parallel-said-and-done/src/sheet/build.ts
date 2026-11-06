/**
 * Builds a sheet from stored Parallel responses. Deterministic: the same raw
 * responses always produce the same sheet, so `npm run rebuild` can re-derive
 * every page after a rule change without new API calls.
 */
import type { FieldBasis, TaskRunResult } from "../parallel/task";

import { OUTCOME_KEY, STANCE_KEY } from "../lib/marks";
import type {
  Citation,
  Company,
  FillLog,
  ImagePick,
  OutcomeStatus,
  Promise as SheetPromise,
  RunRef,
  SheetData,
  SourceRow,
  Stance,
  Statement,
} from "../lib/types";
import { misdated, type CheckOut } from "./check";
import type { ResolveOut } from "./resolve";
import { companyDomains, findPassage, sameCall, toCitation, toVerbatim, type RawCitation } from "./evidence";
import { verbatimFromFill, type FillRecord } from "./fill";
import { evaluateSheet } from "./gate";
import type { StoredRun } from "../parallel/task";

export interface StatementOut {
  promise_id: string;
  date: string;
  call: string;
  speaker: string | null;
  stance: Stance;
  quote: string | null;
  summary: string;
}

export interface SheetOutput {
  exchange: string;
  fiscal_year_end: string;
  investor_relations_url: string;
  latest_call_date: string;
  latest_call_quarter: string;
  next_call_date: string | null;
  next_call_time: string | null;
  next_call_quarter: string | null;
  photo_subject: string;
  promises: {
    promise_id: string;
    label: string;
    commitment: string;
    deadline: string | null;
    first_stated_date: string;
    outcome_status: OutcomeStatus;
    outcome_summary: string;
  }[];
  statements: StatementOut[];
}

export interface TrailOutput {
  statements: (Omit<StatementOut, "promise_id"> & { promise_id?: string; source_type: string })[];
  outcome_status: OutcomeStatus;
  outcome_summary: string;
  outcome_date: string | null;
}

export interface UpdateOutput {
  call_date: string;
  fiscal_quarter: string;
  transcript_url: string;
  statements: StatementOut[];
  promise_updates: { promise_id: string; outcome_status: OutcomeStatus; outcome_summary: string }[];
  /** update@2 and later. */
  new_promises?: NewPromiseOut[];
  next_call_date: string | null;
  next_call_time: string | null;
  next_call_quarter: string | null;
}

export interface NewPromiseOut {
  label: string;
  commitment: string;
  deadline: string | null;
  speaker: string | null;
  quote: string | null;
  summary: string;
}

/** A call date a monitor reported as scheduled, newer than the last Task run's next_call_date. */
export interface ScheduledCall {
  date: string;
  quarter: string | null;
  eventId: string;
}

export interface BuildInput {
  company: Company;
  windowStart: string;
  sheetRun: StoredRun;
  updates: StoredRun[];
  /** Stage 2: one history run per promise. */
  trails?: StoredRun[];
  /** Stage 3: one fact-check run per promise, made on the history it checks. */
  checks?: StoredRun[];
  /** A deeper run that settled an outcome the fact-checks disputed. */
  resolves?: StoredRun[];
  fills: FillRecord[];
  images: { logo: ImagePick | null; photo: ImagePick | null } | null;
  schedule?: ScheduledCall | null;
  version: number;
  builtAt: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Outcomes that close a promise; a later "not mentioned" adds nothing to them. */
const SETTLED = new Set<OutcomeStatus>(["delivered", "exceeded", "missed", "dropped"]);

function outputOf<T>(stored: StoredRun): { content: T; basis: FieldBasis[] } {
  const output = (stored.result as TaskRunResult | null)?.output;
  if (!output || output.type !== "json") throw new Error(`Run ${stored.run.run_id} has no JSON output`);
  return { content: output.content as unknown as T, basis: (output.basis ?? []) as FieldBasis[] };
}

function basisFor(basis: FieldBasis[], field: string): FieldBasis | undefined {
  return basis.find((b) => b.field === field);
}

function rawCitations(b: FieldBasis | undefined): RawCitation[] {
  return (b?.citations ?? []).map((c) => ({ url: c.url, title: c.title ?? null, excerpts: c.excerpts ?? [] }));
}

function runRef(stored: StoredRun, kind: RunRef["kind"], callDate?: string): RunRef {
  const run = stored.run as StoredRun["run"] & { interaction_id?: string; taskgroup_id?: string | null };
  return {
    kind,
    spec: stored.spec,
    runId: run.run_id,
    interactionId: run.interaction_id ?? run.run_id,
    processor: run.processor,
    createdAt: run.created_at ?? "",
    completedAt: run.modified_at ?? null,
    taskGroupId: run.taskgroup_id ?? null,
    previousInteractionId: (stored.input as { previous_interaction_id?: string }).previous_interaction_id ?? null,
    ...(callDate ? { callDate } : {}),
  };
}

export function statementId(ticker: string, s: Pick<StatementOut, "promise_id" | "date">) {
  return `${ticker}-${s.promise_id}-${s.date}`;
}

/** Turns one Task statement plus its basis into a sheet statement with verbatim backing. */
function toStatement(
  company: Company,
  s: StatementOut,
  field: string,
  basis: FieldBasis[],
  promiseTopic: string,
  ownDomains: string[],
  fills: FillRecord[],
  runId: string,
): Statement {
  const id = statementId(company.ticker, s);
  const elementBasis = basisFor(basis, field);
  const cited = rawCitations(elementBasis);
  const target = { quote: s.quote, summary: s.summary, topic: promiseTopic };
  let verbatim: Statement["verbatim"] = null;

  if (s.stance !== "not_mentioned") {
    const own = findPassage(target, cited, ownDomains);
    if (own) {
      verbatim = toVerbatim(own, { via: "task" }, ownDomains);
    } else {
      // Fallback: the list-level basis, but only for an exact quote match.
      const parent = findPassage(target, rawCitations(basisFor(basis, field.replace(/\.\d+$/, ""))), ownDomains, true);
      if (parent) verbatim = toVerbatim(parent, { via: "task" }, ownDomains);
    }
    if (!verbatim) {
      const fill = fills.find((f) => f.statementId === id && f.runId === runId);
      verbatim = fill ? verbatimFromFill(fill, target, ownDomains) : null;
    }
  }

  return {
    id,
    promiseId: s.promise_id,
    date: s.date,
    call: s.call,
    speaker: s.speaker,
    stance: s.stance,
    k: STANCE_KEY[s.stance] ?? "h",
    summary: s.summary,
    quote: s.quote,
    verbatim,
    citations: dedupeCitations(cited.map((c) => toCitation(c, ownDomains))),
    confidence: elementBasis?.confidence ?? null,
    runId,
  };
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

function validStatement(s: StatementOut, promiseIds: Set<string>, windowStart: string, asOf: string) {
  return promiseIds.has(s.promise_id) && ISO_DATE.test(s.date) && s.date >= windowStart && s.date <= asOf;
}

export function buildSheet(input: BuildInput): SheetData {
  const { company, windowStart, sheetRun, updates, fills } = input;
  const { content, basis } = outputOf<SheetOutput>(sheetRun);
  const asOfInput = String((sheetRun.input as { as_of_date?: string }).as_of_date ?? input.builtAt.slice(0, 10));
  const ownDomains = companyDomains(company.website, content.investor_relations_url);
  const sheetRunId = sheetRun.run.run_id;

  const promises: SheetPromise[] = content.promises.map((p, i) => {
    const b = basisFor(basis, `promises.${i}`);
    return {
      id: p.promise_id,
      label: p.label,
      commitment: p.commitment,
      deadline: p.deadline,
      firstStated: p.first_stated_date,
      status: p.outcome_status,
      k: OUTCOME_KEY[p.outcome_status] ?? "open",
      outcomeSummary: p.outcome_summary,
      citations: dedupeCitations(rawCitations(b).map((c) => toCitation(c, ownDomains))),
      confidence: b?.confidence ?? null,
    };
  });
  const promiseIds = new Set(promises.map((p) => p.id));
  const topicOf = (pid: string) => {
    const p = promises.find((x) => x.id === pid);
    return p ? `${p.label} ${p.commitment}` : "";
  };

  let asOf = asOfInput;
  const byId = new Map<string, Statement>();
  let dropped = 0;
  content.statements.forEach((s, i) => {
    if (!validStatement(s, promiseIds, windowStart, asOfInput)) {
      dropped += 1;
      return;
    }
    const st = toStatement(company, s, `statements.${i}`, basis, topicOf(s.promise_id), ownDomains, fills, sheetRunId);
    if (!byId.has(st.id)) byId.set(st.id, st);
  });

  const runs: RunRef[] = [runRef(sheetRun, "sheet")];

  // Stage 2: a promise's own history run replaces the draft statements and outcome for it.
  for (const trail of input.trails ?? []) {
    if (trail.result?.run.status !== "completed") continue;
    const pid = String((trail.input as { promise_id?: string }).promise_id ?? "");
    const p = promises.find((x) => x.id === pid);
    if (!p) continue;
    const out = outputOf<TrailOutput>(trail);
    const horizon = String((trail.input as { as_of_date?: string }).as_of_date ?? asOfInput);
    for (const [id, st] of byId) if (st.promiseId === pid) byId.delete(id);
    out.content.statements.forEach((s, i) => {
      const so: StatementOut = { ...s, promise_id: pid };
      if (!validStatement(so, promiseIds, windowStart, horizon > asOfInput ? horizon : asOfInput)) {
        dropped += 1;
        return;
      }
      const st = { ...toStatement(company, so, `statements.${i}`, out.basis, topicOf(pid), ownDomains, fills, trail.run.run_id), sourceType: s.source_type };
      if (!byId.has(st.id)) byId.set(st.id, st);
    });
    const ob = basisFor(out.basis, "outcome_summary") ?? basisFor(out.basis, "outcome_status");
    p.status = out.content.outcome_status;
    p.k = OUTCOME_KEY[out.content.outcome_status] ?? p.k;
    p.outcomeSummary = out.content.outcome_summary;
    p.outcomeDate = out.content.outcome_date;
    p.citations = dedupeCitations([...rawCitations(ob).map((c) => toCitation(c, ownDomains)), ...p.citations]);
    const first = out.content.statements.map((x) => x.date).filter((d) => ISO_DATE.test(d)).sort()[0];
    if (first) p.firstStated = first;
    if (ob?.confidence) p.confidence = ob.confidence;
    runs.push(runRef(trail, "trail"));
  }
  let latestCall = { date: content.latest_call_date, quarter: content.latest_call_quarter };
  let nextCall: SheetData["nextCall"] = { date: content.next_call_date, time: content.next_call_time, quarter: content.next_call_quarter };

  // Promises whose outcome a later call's update run changed, and that call's date.
  const touchedAfter = new Map<string, string>();
  const orderedUpdates = [...updates].sort((a, b) =>
    String((a.input as { call_date: string }).call_date).localeCompare(String((b.input as { call_date: string }).call_date)),
  );
  for (const update of orderedUpdates) {
    if (update.result?.run.status !== "completed") continue;
    const out = outputOf<UpdateOutput>(update);
    const callDate = String((update.input as { call_date: string }).call_date);
    runs.push(runRef(update, "update", callDate));
    const horizon = callDate > asOf ? callDate : asOf;
    // Silence about a promise that was already settled before this call is not news, and an
    // announcement between calls is about what it is about: drop those not_mentioned entries.
    const settledBefore = new Set(promises.filter((p) => SETTLED.has(p.status)).map((p) => p.id));
    const announcement = (update.input as { source_type?: string }).source_type === "company_statement";
    out.content.statements.forEach((s, i) => {
      if (!validStatement(s, promiseIds, windowStart, horizon)) return;
      if (s.stance === "not_mentioned" && (announcement || settledBefore.has(s.promise_id))) return;
      const st = toStatement(company, s, `statements.${i}`, out.basis, topicOf(s.promise_id), ownDomains, fills, update.run.run_id);
      byId.set(st.id, st);
    });
    out.content.promise_updates.forEach((u, i) => {
      const p = promises.find((x) => x.id === u.promise_id);
      if (!p) return;
      if (u.outcome_status !== p.status || u.outcome_summary !== p.outcomeSummary) touchedAfter.set(p.id, callDate);
      const b = basisFor(out.basis, `promise_updates.${i}`);
      p.status = u.outcome_status;
      p.k = OUTCOME_KEY[u.outcome_status] ?? p.k;
      p.outcomeSummary = u.outcome_summary;
      p.citations = dedupeCitations([...rawCitations(b).map((c) => toCitation(c, ownDomains)), ...p.citations]);
    });
    // New promises take the next ids (P6, P7, …) in the order the run listed them.
    (out.content.new_promises ?? []).forEach((np, i) => {
      const label = np.label?.trim();
      if (!label || promises.some((p) => p.label.toLowerCase() === label.toLowerCase())) return;
      const id = `P${promises.length + 1}`;
      const b = basisFor(out.basis, `new_promises.${i}`);
      promises.push({
        id,
        label,
        commitment: np.commitment,
        deadline: np.deadline,
        firstStated: out.content.call_date,
        status: "open",
        k: "open",
        outcomeSummary: `First stated on the ${out.content.fiscal_quarter} call; no outcome yet.`,
        citations: dedupeCitations(rawCitations(b).map((c) => toCitation(c, ownDomains))),
        confidence: b?.confidence ?? null,
        addedOn: out.content.call_date,
        addedBy: update.run.run_id,
      });
      promiseIds.add(id);
      const first: StatementOut = {
        promise_id: id,
        date: out.content.call_date,
        call: `${out.content.fiscal_quarter} earnings call`,
        speaker: np.speaker,
        stance: "stated",
        quote: np.quote,
        summary: np.summary,
      };
      if (!validStatement(first, promiseIds, windowStart, horizon)) return;
      const st = toStatement(company, first, `new_promises.${i}`, out.basis, `${label} ${np.commitment}`, ownDomains, fills, update.run.run_id);
      byId.set(st.id, st);
    });
    if (out.content.call_date >= latestCall.date) latestCall = { date: out.content.call_date, quarter: out.content.fiscal_quarter };
    nextCall = { date: out.content.next_call_date, time: out.content.next_call_time, quarter: out.content.next_call_quarter };
    asOf = horizon;
  }

  // A monitor's scheduled-call event is newer than the last Task run; use it when it is still ahead.
  const schedule = input.schedule;
  if (schedule && schedule.date > latestCall.date && schedule.date !== nextCall.date) {
    nextCall = { date: schedule.date, time: null, quarter: schedule.quarter ?? nextCall.quarter, source: "monitor" };
  }

  // A disputed outcome settled by a resolution run: its outcome, with its citations, is the one published.
  for (const r of input.resolves ?? []) {
    if (r.result?.run.status !== "completed") continue;
    const pid = String((r.run.metadata as Record<string, unknown> | null)?.promise ?? "");
    const p = promises.find((x) => x.id === pid);
    if (!p) continue;
    // A later call's update run speaks for itself.
    const settledAsOf = String((r.input as { as_of_date?: string }).as_of_date ?? "");
    if (runs.some((x) => x.kind === "update" && (x.callDate ?? "") > settledAsOf)) continue;
    const out = outputOf<ResolveOut>(r);
    const b = basisFor(out.basis, "outcome_summary") ?? basisFor(out.basis, "outcome_status");
    p.resolved = { runId: r.run.run_id, from: p.status, reason: out.content.reason };
    p.status = out.content.outcome_status;
    p.k = OUTCOME_KEY[out.content.outcome_status] ?? p.k;
    p.outcomeSummary = out.content.outcome_summary;
    p.outcomeDate = out.content.outcome_date;
    p.citations = dedupeCitations([...rawCitations(b).map((c) => toCitation(c, ownDomains)), ...p.citations]);
    runs.push(runRef(r, "check"));
  }

  // Stage 3: fact-checks, by majority when a dispute was put to more than one independent check.
  // A statement is held back when most checks place it on a different date.
  let heldByCheck = 0;
  const byPromise = new Map<string, StoredRun[]>();
  for (const check of input.checks ?? []) {
    if (check.result?.run.status !== "completed") continue;
    const pid = String((check.run.metadata as Record<string, unknown> | null)?.promise ?? "");
    if (promises.some((x) => x.id === pid)) byPromise.set(pid, [...(byPromise.get(pid) ?? []), check]);
  }
  for (const [pid, all] of byPromise) {
    const p = promises.find((x) => x.id === pid)!;
    // A check made before a later call changed this outcome no longer vouches for it.
    const changed = touchedAfter.get(pid);
    const checks = changed ? all.filter((c) => String((c.input as { as_of_date?: string }).as_of_date ?? "") >= changed) : all;
    if (!checks.length) continue;
    const outs = checks.map((c) => ({ run: c, out: outputOf<CheckOut>(c).content }));
    const votes = { correct: 0, incorrect: 0, unclear: 0 };
    for (const o of outs) votes[o.out.outcome_verdict] += 1;
    const verdict = votes.incorrect > votes.correct ? "incorrect" : votes.correct > votes.incorrect ? "correct" : "unclear";
    const lead = outs.find((o) => o.out.outcome_verdict === verdict) ?? outs[0];
    const movedVotes = new Map<string, number>();
    for (const o of outs) for (const date of misdated(o.run.input as { claimed_statements: string }, o.out).keys()) movedVotes.set(date, (movedVotes.get(date) ?? 0) + 1);
    const moved = [...movedVotes].filter(([, n]) => n * 2 > outs.length).map(([d]) => d);
    for (const [id, st] of byId) {
      if (st.promiseId === pid && moved.includes(st.date)) {
        byId.delete(id);
        heldByCheck += 1;
      }
    }
    p.factCheck = {
      runId: lead.run.run.run_id,
      verdict,
      status: lead.out.outcome_status,
      summaryErrors: lead.out.outcome_summary_errors,
      held: moved.length,
      missing: lead.out.missing_statements,
      checks: outs.length,
      agree: votes[verdict as keyof typeof votes],
    };
    for (const c of checks) runs.push(runRef(c, "check"));
  }

  // A quote whose source names a different call than the statement's is held back, whichever stage produced it.
  let heldSameCall = 0;
  for (const [id, st] of byId) {
    if (st.verbatim && !sameCall(st.call, st.verbatim.backing, st.date)) {
      byId.delete(id);
      heldSameCall += 1;
    }
  }

  const order = new Map(promises.map((p, i) => [p.id, i]));
  const statements = [...byId.values()].sort(
    (a, b) => (order.get(a.promiseId) ?? 0) - (order.get(b.promiseId) ?? 0) || a.date.localeCompare(b.date),
  );

  const steps = fills.flatMap((f) => f.steps.map((step) => ({ step, statementId: f.statementId })));
  const fillLog: FillLog = {
    searches: steps.flatMap(({ step, statementId }) => (step.kind === "search" ? [{ id: step.response.search_id, statementId }] : [])),
    extracts: steps.flatMap(({ step, statementId }) => (step.kind === "extract" ? [{ id: step.response.extract_id, statementId }] : [])),
    filled: statements.filter((s) => s.verbatim && s.verbatim.backing.via !== "task").length,
  };

  const sheet: SheetData = {
    schema: "said-done.sheet/1",
    ticker: company.ticker,
    name: company.name,
    short: company.short,
    website: company.website,
    exchange: content.exchange,
    fiscalYearEnd: content.fiscal_year_end,
    irUrl: content.investor_relations_url,
    asOf,
    windowStart,
    latestCall,
    nextCall,
    photoSubject: content.photo_subject,
    promises,
    statements,
    sources: sourceRows(promises, statements),
    focus: focusPromise(promises, statements),
    runs,
    fills: fillLog,
    gate: { kind: "sheet", checks: [], passed: false },
    images: input.images ?? { logo: null, photo: null },
    version: input.version,
    builtAt: input.builtAt,
  };
  sheet.gate = evaluateSheet(sheet, { dropped, heldSameCall, heldByCheck });
  return sheet;
}

/** Sources ranked by how many promises they back, company sources first on ties. */
export function sourceRows(promises: SheetPromise[], statements: Statement[]): SourceRow[] {
  const rows = new Map<string, { c: Citation; pids: Set<string>; n: number }>();
  const add = (c: Citation, pid: string) => {
    const row = rows.get(c.url) ?? { c, pids: new Set<string>(), n: 0 };
    row.pids.add(pid);
    row.n += 1;
    if (!row.c.title && c.title) row.c = c;
    rows.set(c.url, row);
  };
  for (const s of statements) {
    for (const c of s.citations) add(c, s.promiseId);
    if (s.verbatim && !s.citations.some((c) => c.url === s.verbatim!.backing.url)) {
      const b = s.verbatim.backing;
      add({ url: b.url, title: b.title, domain: b.domain, tier: b.tier }, s.promiseId);
    }
  }
  for (const p of promises) for (const c of p.citations) add(c, p.id);
  const tierRank = { primary: 0, transcript: 1, press: 2 } as const;
  return [...rows.values()]
    .sort((a, b) => b.pids.size - a.pids.size || tierRank[a.c.tier] - tierRank[b.c.tier] || b.n - a.n)
    .map((r, i) => ({
      n: i + 1,
      url: r.c.url,
      title: r.c.title ?? r.c.domain,
      domain: r.c.domain,
      tier: r.c.tier,
      uses: [...r.pids].sort().join(" "),
    }));
}

/** Default paper-trail promise: most verbatim statements, then most statements, then most changes. */
export function focusPromise(promises: SheetPromise[], statements: Statement[]): string {
  const score = (pid: string) => {
    const ss = statements.filter((s) => s.promiseId === pid);
    return [ss.filter((s) => s.verbatim).length, ss.length, ss.filter((s) => s.k === "c").length];
  };
  let best = promises[0]?.id ?? "P1";
  let bestScore = [-1, -1, -1];
  for (const p of promises) {
    const sc = score(p.id);
    if (sc[0] > bestScore[0] || (sc[0] === bestScore[0] && (sc[1] > bestScore[1] || (sc[1] === bestScore[1] && sc[2] > bestScore[2])))) {
      best = p.id;
      bestScore = sc;
    }
  }
  return best;
}

