import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildSheet } from "../src/sheet/build";
import { evaluateUpdate } from "../src/sheet/gate";
import type { StoredRun } from "../src/parallel/task";
import type { CallDayRecord } from "../src/lib/types";

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
