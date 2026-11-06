import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildSheet } from "../src/sheet/build";
import { agreement, matchPassages } from "../src/updates/callday";
import { decide } from "../src/updates/monitor-events";
import type { StoredRun } from "../src/parallel/task";
import { readCall } from "../src/updates/callday";
import { newRecord } from "../src/updates/update";
import Parallel from "parallel-web";
import { compareWithTask } from "../src/updates/callday";
import { createMonitors } from "../src/updates/monitors";
import { advance, onRunComplete } from "../src/pipeline/advance";
import { fileStorage, useStorage } from "../src/storage";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = JSON.parse(readFileSync(new URL("./fixtures/sheet-run.json", import.meta.url), "utf8")) as StoredRun;
const company = { ticker: "EXM", name: "Example Corp", short: "Example", website: "example.com" };
const sheet = buildSheet({ company, windowStart: "2021-01-01", sheetRun: run, updates: [], fills: [], images: null, version: 1, builtAt: "2026-10-22T00:00:00Z" });

test("sheet gate holds a sheet with too little verbatim backing", () => {
  assert.equal(sheet.gate.checks.find((c) => c.id === "register")?.result, "pass");
  assert.equal(sheet.gate.checks.find((c) => c.id === "verbatim")?.result, "fail");
  assert.equal(sheet.gate.passed, false);
});

test("call-day passages join a promise only with two shared keywords", () => {
  const passages = matchPassages(sheet, [
    "Turning to output. Widget output reached 1.5 million units this quarter, and the 2026 target stands.",
    "Our cafeteria menu changed this quarter with 12% more vegetarian lunch options for everyone.",
  ]);
  const matched = passages.find((p) => p.promiseId === "P1");
  assert.ok(matched, "widget passage matches P1");
  assert.ok(matched!.hits.includes("widget"));
  assert.ok(passages.some((p) => p.promiseId === null));
});

test("figure agreement", () => {
  assert.equal(agreement("range of $135-145 billion", "range of $135 billion-$145 billion").agree, "same");
  assert.equal(agreement("$15B loss", "$15 billion loss, then $10 billion").agree, "part");
  assert.equal(agreement("$20 billion", "$15 billion").agree, "diff");
  assert.equal(agreement("no numbers here", "$15 billion").agree, "none");
});

test("monitor routing acts only on a newer call that was held", () => {
  const base = { call_date: "2026-10-27", fiscal_quarter: "Q3 2026", transcript_url: null, results_release_url: null };
  assert.equal(decide(sheet, { event_kind: "earnings_call_scheduled", ...base }).action, "schedule");
  assert.equal(decide(sheet, { event_kind: "earnings_call_scheduled", ...base, call_date: "2026-07-01" }).action, "ignore");
  assert.equal(decide(sheet, { event_kind: "other", ...base }).action, "ignore");
  assert.equal(decide(sheet, { event_kind: "earnings_call_held", ...base }).action, "update");
  assert.equal(decide(sheet, { event_kind: "earnings_call_held", ...base, call_date: "2026-07-20" }).action, "covered");
  assert.equal(decide(null, { event_kind: "earnings_call_held", ...base }).action, "ignore");
});


test("an announcement updates the sheet only from a company source, about a tracked promise, after what the sheet read", () => {
  const pid = sheet.promises[0].id;
  const after = "2099-01-02";
  const event = { event_kind: "promise_update" as const, call_date: after, fiscal_quarter: null, transcript_url: null, results_release_url: null, promise_id: pid, source_url: "https://www.example.com/news/update", source_title: "Press release", summary: "" };
  const today = "2099-01-03";
  assert.equal(decide(sheet, event, today).action, "event");
  assert.equal(decide(sheet, { ...event, source_url: "https://www.sec.gov/Archives/edgar/data/1/x.htm" }, today).action, "event");
  assert.equal(decide(sheet, { ...event, source_url: "https://www.reuters.com/business/x" }, today).action, "ignore");
  assert.equal(decide(sheet, { ...event, promise_id: "P99" }, today).action, "ignore");
  assert.equal(decide(sheet, { ...event, call_date: sheet.latestCall.date }, today).action, "ignore");
  assert.equal(decide(sheet, { ...event, call_date: "2099-02-01" }, today).action, "ignore");
});


test("figure agreement preserves units, signs and incomplete ranges", () => {
  assert.equal(agreement("$5 million", "$5 billion").agree, "diff");
  assert.equal(agreement("up 5%", "5 basis points").agree, "diff");
  assert.equal(agreement("margin -5%", "margin 5%").agree, "diff");
  assert.equal(agreement("$50 to $60 million", "$50 to $90 million").agree, "part");
});

test("a Search hit whose Extract response contains only errors leaves the call waiting", async () => {
  const client = new Parallel({ apiKey: "test", baseURL: "https://example.test", fetch: async url => {
    const result = String(url).endsWith("/search") ? { search_id: "s", results: [{ url: "https://investors.example.com/remarks", title: "Q3 2026 prepared remarks" }] }
      : { extract_id: "e", results: [], errors: [{ error_type: "fetch_error" }] };
    return Response.json(result);
  } });
  const record = newRecord("EXM", "2026-10-27", "Q3 2026", { kind: "manual", monitorId: null, eventId: null, eventGroupId: null, eventDate: null, content: null, citations: [] });
  const result = await readCall(client, company, sheet, record, "test-session", async () => {});
  assert.equal(result.status, "waiting_transcript");
  assert.equal(result.extract, null);
});


test("a fresh checkout skips paid work on recorded snapshots", async () => {
  let requests = 0;
  const client = new Parallel({ apiKey: "test", fetch: async () => { requests++; throw new Error("Unexpected request"); } });
  const store = fileStorage(mkdtempSync(join(tmpdir(), "said-done-snapshot-")));
  useStorage(store);
  await store.put("data/sheets/MSFT.json", readFileSync(new URL("../data/sheets/MSFT.json", import.meta.url), "utf8"));
  await createMonitors(client, ["MSFT"], () => {});
  await advance(client, "MSFT", () => {});
  assert.equal(requests, 0);
});

test("a completion can only resume a run tracked for its original ticker", async () => {
  const store = fileStorage(mkdtempSync(join(tmpdir(), "said-done-resume-")));
  useStorage(store);
  await store.put("output/inflight/MSFT.json", JSON.stringify({ other: { kind: "sheet-run", spec: "sheet@2" } }));
  const client = new Parallel({ apiKey: "test", fetch: async () => Response.json({ is_active: false, status: "completed", metadata: { ticker: "GM", app: "said-and-done" } }) });
  assert.equal(await onRunComplete(client, "other", () => {}), "ignored");
});

test("the cross-check compares the Task's claim to Extract, even when both found the same passage", () => {
  const st = sheet.statements.find(s => s.verbatim)!;
  const record = newRecord("EXM", st.date, st.call, { kind: "manual", monitorId: null, eventId: null, eventGroupId: null, eventDate: null, citations: [], content: null });
  const text = "Widget output delivered $5 million.";
  const altered = { ...st, summary: "Widget output delivered $5 billion.", verbatim: { ...st.verbatim!, text } };
  record.passages = [{ text, segs: [], promiseId: st.promiseId, hits: [], task: null, agree: "none", shared: [] }];
  assert.equal(compareWithTask(record, { ...sheet, statements: [altered] }, null).passages[0].agree, "diff");
});
