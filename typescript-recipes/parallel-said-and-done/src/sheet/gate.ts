/**
 * Quality gate. A sheet is published to the home page only when no check
 * fails. Every check is a count over stored output; thresholds live here.
 */
import type { CallDayRecord, GateCheck, GateReport, SheetData } from "../lib/types";

export const THRESHOLDS = {
  promises: 5,
  minStatementsPerPromise: 2,
  citedShare: 0.9,
  verbatimPass: 0.65,
  verbatimFail: 0.5,
  updateVerbatimFail: 0.5,
  callWindowDays: 2,
  maxConflictShare: 0.5,
};

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function check(id: string, label: string, result: GateCheck["result"], detail: string): GateCheck {
  return { id, label, result, detail };
}

function report(kind: GateReport["kind"], checks: GateCheck[]): GateReport {
  return { kind, checks, passed: checks.every((c) => c.result !== "fail") };
}

const ID = /^P\d+$/;

export function evaluateSheet(sheet: SheetData, extra: { dropped: number; heldSameCall?: number; heldByCheck?: number }): GateReport {
  const checks: GateCheck[] = [];
  // Five from the sheet run, plus any that later update runs added as P6, P7, …
  const ids = sheet.promises.map((p) => p.id);
  const sequential = ids.every((id, i) => id === `P${i + 1}`);
  const registerOk = ids.length >= THRESHOLDS.promises && new Set(ids).size === ids.length && ids.every((id) => ID.test(id)) && sequential;
  const added = sheet.promises.filter((p) => p.addedBy).length;
  checks.push(
    check(
      "register",
      `Promise register, P1 to P${ids.length}`,
      registerOk ? "pass" : "fail",
      `${ids.length} promises${added ? `, ${added} added by update runs` : ""}: ${ids.join(" ")}`,
    ),
  );

  // A promise an update run just added has one statement by definition; depth applies to the rest.
  const thin = sheet.promises.filter(
    (p) => !p.addedBy && sheet.statements.filter((s) => s.promiseId === p.id).length < THRESHOLDS.minStatementsPerPromise,
  );
  checks.push(
    check(
      "depth",
      `At least ${THRESHOLDS.minStatementsPerPromise} dated statements per promise`,
      thin.length === 0 ? "pass" : thin.length === 1 ? "warn" : "fail",
      thin.length ? `Thin: ${thin.map((p) => p.id).join(" ")}` : `${sheet.statements.length} statements`,
    ),
  );

  const said = sheet.statements.filter((s) => s.stance !== "not_mentioned");
  const cited = said.filter((s) => s.citations.length > 0 || s.verbatim).length;
  const citedShare = said.length ? cited / said.length : 0;
  checks.push(
    check("cited", "Statements with a cited source", citedShare >= THRESHOLDS.citedShare ? "pass" : "fail", `${cited} of ${said.length} (${pct(citedShare)})`),
  );

  const verbatim = said.filter((s) => s.verbatim).length;
  const vShare = said.length ? verbatim / said.length : 0;
  checks.push(
    check(
      "verbatim",
      "Statements backed by verbatim source text",
      vShare >= THRESHOLDS.verbatimPass ? "pass" : vShare >= THRESHOLDS.verbatimFail ? "warn" : "fail",
      `${verbatim} of ${said.length} (${pct(vShare)}); ${sheet.fills.filled} filled by Search or Extract`,
    ),
  );

  checks.push(
    check(
      "dates",
      "Statement dates inside the window",
      extra.dropped === 0 ? "pass" : "warn",
      extra.dropped ? `${extra.dropped} statements dropped for a bad promise id or date` : `${sheet.windowStart} to ${sheet.asOf}`,
    ),
  );

  const held = (extra.heldSameCall ?? 0) + (extra.heldByCheck ?? 0);
  checks.push(
    check(
      "same-call",
      "Each quote from the call it is dated to",
      "pass",
      held
        ? `${held} held back: ${extra.heldSameCall ?? 0} whose source names another call, ${extra.heldByCheck ?? 0} the fact-check placed on another date`
        : "No statement sourced from a different call",
    ),
  );

  const checked = sheet.promises.filter((p) => p.factCheck);
  if (checked.length) {
    const confirmed = checked.filter((p) => p.factCheck!.verdict === "correct" && !p.factCheck!.summaryErrors.length);
    const disputed = checked.filter((p) => !confirmed.includes(p));
    checks.push(
      check(
        "fact-check",
        "Outcomes confirmed by an independent fact-check",
        checked.filter(p => p.factCheck!.verdict === "incorrect").length > 1 ? "fail" : confirmed.length === sheet.promises.length ? "pass" : "warn",
        `${confirmed.length} of ${sheet.promises.length} confirmed${disputed.length ? `; flagged: ${disputed.map((p) => p.id).join(" ")}` : ""}`,
      ),
    );
  }

  checks.push(
    check(
      "calendar",
      "Latest call known",
      sheet.latestCall.date ? "pass" : "fail",
      `${sheet.latestCall.quarter} on ${sheet.latestCall.date}${sheet.nextCall.date ? `; next ${sheet.nextCall.date}` : "; next call not announced"}`,
    ),
  );
  return report("sheet", checks);
}

function daysBetween(a: string, b: string) {
  return Math.abs(new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000;
}

/** Checks a monitor-triggered update before its sheet replaces the published one. */
export function evaluateUpdate(sheet: SheetData, record: CallDayRecord, updateRunId: string): GateReport {
  const checks: GateCheck[] = [];
  const run = sheet.runs.find((r) => r.runId === updateRunId);
  checks.push(check("run", "Update run completed", run ? "pass" : "fail", run ? `${run.spec} · ${run.processor}` : "No completed update run"));

  const fresh = sheet.statements.filter((s) => s.runId === updateRunId);
  const onCall = fresh.filter((s) => daysBetween(s.date, record.callDate) <= THRESHOLDS.callWindowDays);
  const said = onCall.filter((s) => s.stance !== "not_mentioned");
  const newPromises = sheet.promises.filter((p) => p.addedBy === updateRunId);
  const tracked = sheet.promises.length - newPromises.length;
  const addressed = said.filter((s) => !newPromises.some((p) => p.id === s.promiseId)).length;
  checks.push(
    check(
      "covers-call",
      "Statements from the new call",
      said.length > 0 ? "pass" : "fail",
      `${addressed} of ${tracked} tracked promises addressed on ${record.callDate}` +
        `${newPromises.length ? `; ${newPromises.length} new ${newPromises.length === 1 ? "promise" : "promises"}` : ""}`,
    ),
  );

  const outside = fresh.filter((s) => !sheet.promises.some((p) => p.id === s.promiseId));
  checks.push(
    check(
      "register",
      "Register intact",
      outside.length === 0 ? "pass" : "fail",
      outside.length ? `${outside.length} statements on unknown promises` : `P1 to P${sheet.promises.length}`,
    ),
  );

  // Each new promise needs a cited first statement from this call.
  const uncited = newPromises.filter((p) => {
    const first = fresh.find((s) => s.promiseId === p.id);
    return !first || (first.citations.length === 0 && !first.verbatim);
  });
  checks.push(
    check(
      "new-promises",
      "New promises cited",
      uncited.length === 0 ? "pass" : "fail",
      newPromises.length ? `${newPromises.length - uncited.length} of ${newPromises.length}: ${newPromises.map((p) => p.label).join("; ")}` : "None added",
    ),
  );

  const cited = said.filter((s) => s.citations.length > 0 || s.verbatim).length;
  checks.push(check("cited", "New statements cited", said.length === 0 || cited === said.length ? "pass" : "fail", `${cited} of ${said.length}`));

  const verbatim = said.filter((s) => s.verbatim).length;
  const vShare = said.length ? verbatim / said.length : 0;
  checks.push(
    check(
      "verbatim",
      "New statements backed by verbatim text",
      vShare >= THRESHOLDS.updateVerbatimFail ? "pass" : "fail",
      `${verbatim} of ${said.length} (${pct(vShare)})`,
    ),
  );

  const compared = record.passages.filter((p) => p.task && p.agree !== "none");
  const conflicts = compared.filter((p) => p.agree === "diff").length;
  checks.push(
    check(
      "crosscheck",
      "Call-day excerpts agree with the Task",
      compared.length === 0 ? "warn" : conflicts / compared.length > THRESHOLDS.maxConflictShare ? "fail" : "pass",
      compared.length === 0
        ? "No matched excerpt to compare"
        : `${compared.filter((p) => p.agree === "same").length} same figures, ${compared.filter((p) => p.agree === "part").length} partly, ${conflicts} different`,
    ),
  );

  checks.push(
    check(
      "transcript",
      record.kind === "event" ? "Announcement read by Extract" : "Transcript found by Search",
      record.extract ? "pass" : "warn",
      record.extract ? record.extract.url : "Update ran without a transcript URL",
    ),
  );
  return report("update", checks);
}
