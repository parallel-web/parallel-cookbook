import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildSheet } from "../src/sheet/build";
import { evaluateUpdate } from "../src/sheet/gate";
import type { StoredRun } from "../src/parallel/task";
import type { CallDayRecord } from "../src/lib/types";
import { updateRunRequest } from "../src/updates/spec";
import { evaluateSheet } from "../src/sheet/gate";

const sheetRun = JSON.parse(readFileSync(new URL("./fixtures/sheet-run.json", import.meta.url), "utf8")) as StoredRun;
const company = { ticker: "EXM", name: "Example Corp", short: "Example", website: "example.com" };

const notMentioned = (pid: string) => ({
  promise_id: pid,
  date: "2026-10-27",
  call: "Q3 2026 earnings call",
  speaker: null,
  stance: "not_mentioned",
  quote: null,
  summary: "Not discussed.",
});

const update = {
  spec: "update@2",
  input: { call_date: "2026-10-27", fiscal_quarter: "Q3 2026" },
  run: { run_id: "trun_update", interaction_id: "trun_update", status: "completed", is_active: false, processor: "ultra" },
  result: {
    run: { run_id: "trun_update", status: "completed", is_active: false, processor: "ultra" },
    output: {
      type: "json",
      content: {
        call_date: "2026-10-27",
        fiscal_quarter: "Q3 2026",
        transcript_url: "https://investors.example.com/q3-2026",
        statements: ["P1", "P2", "P3", "P4", "P5"].map(notMentioned),
        promise_updates: [],
        new_promises: [
          {
            label: "Widget margin of 12% by 2029",
            commitment: "Reach a 12% widget margin by 2029.",
            deadline: "2029",
            speaker: "Ann Lee, CEO",
            quote: "We are targeting a 12% widget margin by 2029.",
            summary: "New target: 12% widget margin by 2029.",
          },
          { label: "Double widget output", commitment: "Duplicate of P1.", deadline: null, speaker: null, quote: null, summary: "Same as P1." },
        ],
        next_call_date: null,
        next_call_time: null,
        next_call_quarter: null,
      },
      basis: [
        {
          field: "new_promises.0",
          citations: [{ url: "https://investors.example.com/q3-2026", title: "Q3 2026 call", excerpts: ["Thanks. We are targeting a 12% widget margin by 2029. Next question."] }],
          reasoning: "",
          confidence: "high",
        },
      ],
    },
  },
} as unknown as StoredRun;

const sheet = buildSheet({ company, windowStart: "2021-01-01", sheetRun, updates: [update], fills: [], images: null, version: 2, builtAt: "2026-10-30T00:00:00Z" });

test("an update run adds a new promise as P6 with a verbatim first statement", () => {
  const p6 = sheet.promises.find((p) => p.id === "P6");
  assert.ok(p6);
  assert.equal(p6.status, "open");
  assert.equal(p6.addedBy, "trun_update");
  assert.equal(p6.firstStated, "2026-10-27");
  const first = sheet.statements.find((s) => s.promiseId === "P6");
  assert.equal(first?.stance, "stated");
  assert.equal(first?.verbatim?.match, "exact");
  // A new promise with the same label as a tracked one is not added twice.
  assert.equal(sheet.promises.length, 6);
});

test("the gate passes a call that only added new promises, and checks they are cited", () => {
  const record = { callDate: "2026-10-27", passages: [], extract: { id: "x", request: {}, url: "u" } } as unknown as CallDayRecord;
  const gate = evaluateUpdate(sheet, record, "trun_update");
  assert.equal(gate.checks.find((c) => c.id === "covers-call")?.result, "pass");
  assert.equal(gate.checks.find((c) => c.id === "new-promises")?.result, "pass");
  assert.equal(gate.checks.find((c) => c.id === "register")?.result, "pass");
  assert.ok(gate.passed);
});

test("a monitor's scheduled date replaces a missing next call", () => {
  const withSchedule = buildSheet({
    company,
    windowStart: "2021-01-01",
    sheetRun,
    updates: [update],
    fills: [],
    images: null,
    schedule: { date: "2027-01-28", quarter: "Q4 2026", eventId: "mevt_x" },
    version: 2,
    builtAt: "2026-10-30T00:00:00Z",
  });
  assert.deepEqual(withSchedule.nextCall, { date: "2027-01-28", time: null, quarter: "Q4 2026", source: "monitor" });
});

test("an announcement between calls is not a call: the latest call and next call stay put", () => {
  const announcement = {
    ...update,
    input: { call_date: "2026-11-05", fiscal_quarter: "Example Corp Announces Quarterly Dividend", source_type: "company_statement" },
    result: {
      ...(update.result as object),
      output: {
        ...((update.result as unknown as { output: object }).output),
        content: {
          ...((update.result as unknown as { output: { content: object } }).output.content),
          call_date: "2026-11-05",
          fiscal_quarter: "Example Corp Announces Quarterly Dividend",
          next_call_date: null,
        },
      },
    },
  } as unknown as StoredRun;
  const withAnnouncement = buildSheet({ company, windowStart: "2021-01-01", sheetRun, updates: [update, announcement], fills: [], images: null, version: 3, builtAt: "2026-11-06T00:00:00Z" });
  assert.deepEqual(withAnnouncement.latestCall, sheet.latestCall);
  assert.deepEqual(withAnnouncement.nextCall, sheet.nextCall);
});


const baseInput = { company, windowStart: "2021-01-01", sheetRun, updates: [update], fills: [], images: null, version: 2, builtAt: sheet.builtAt };

test("an announcement does not advance the call calendar or invent an earnings call", () => {
  const initial = buildSheet({ ...baseInput, updates: [] });
  const event = { ...update, input: { ...update.input, source_type: "company_statement" } };
  const result = buildSheet({ ...baseInput, updates: [event] });
  assert.deepEqual(result.latestCall, initial.latestCall);
  assert.deepEqual(result.nextCall, initial.nextCall);
  assert.doesNotMatch(result.statements.find(s => s.promiseId === "P6")!.call, /earnings call/i);
});

test("the update chain follows the register even after independent checks", () => {
  const last = { ...sheet.runs[0], kind: "check" as const, interactionId: "unrelated-check" };
  const request = updateRunRequest(company, { ...sheet, runs: [...sheet.runs, last] }, { date: "2026-11-12", quarter: "Q4", transcriptUrl: null });
  assert.equal(request.previous_interaction_id, "trun_update");
});

test("a history for a promise discovered by an update contributes its earlier statements", () => {
  const trailRun = structuredClone(sheetRun.run);
  trailRun.run_id = "trail-6";
  trailRun.created_at = "2026-10-29T10:00:00Z";
  const trail = { ...sheetRun, run: trailRun, input: { promise_id: "P6", as_of_date: "2026-10-29" },
    result: { ...sheetRun.result!, output: { type: "json" as const, basis: [], content: { outcome_status: "revised", outcome_summary: "Management revised its target.", outcome_date: "2026-10-28",
      statements: [{ date: "2026-07-20", call: "Q2 2026 earnings call", stance: "stated", speaker: null, quote: null, summary: "Initial margin guidance.", source_type: "earnings_call" }] } } } };
  const result = buildSheet({ ...baseInput, trails: [trail] });
  const p = result.promises.find(p => p.id === "P6")!;
  assert.equal(p.firstStated, "2026-07-20");
  assert.equal(p.status, "revised");
  assert.equal(result.asOf, "2026-10-29");
  assert.ok(result.runs.some(r => r.kind === "trail" && r.runId === "trail-6"));
});

test("unclear fact-checks never count as confirmed", () => {
  const promises = sheet.promises.map(p => ({ ...p, factCheck: { verdict: "unclear" as const, status: p.status, held: 0, summaryErrors: [], missing: [] } }));
  const report = evaluateSheet({ ...sheet, promises }, { dropped: 0 });
  const check = report.checks.find(c => c.id === "fact-check")!;
  assert.notEqual(check.result, "pass");
  assert.match(check.detail, /^0 of /);
});
