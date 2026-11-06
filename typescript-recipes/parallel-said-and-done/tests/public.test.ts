import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import type { SheetData } from "../src/lib/types";
import type { StoredRun } from "../src/parallel/task";
import { buildSheet } from "../src/sheet/build";
import { MAX_QUOTE_WORDS, findPassage } from "../src/sheet/evidence";
import type { FillRecord } from "../src/sheet/fill";
import { REQUEST_ID, publicSheet } from "../src/sheet/public";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/sheet-run.json", import.meta.url), "utf8")) as StoredRun;
// Real-looking IDs, so the test proves they are dropped.
const RUN_ID = "trun_0123456789abcdef";
const run: StoredRun = { ...fixture, run: { ...fixture.run, run_id: RUN_ID, interaction_id: RUN_ID, taskgroup_id: "tgrp_0123456789abcdef" } as StoredRun["run"] };
const company = { ticker: "EXM", name: "Example Corp", short: "Example", website: "example.com" };

test("the published copy drops request IDs and keeps what made each part", () => {
  const fill: FillRecord = {
    statementId: "EXM-P2-2025-01-20",
    runId: RUN_ID,
    createdAt: "2026-10-22T00:00:00Z",
    steps: [
      {
        kind: "extract",
        request: { objective: "savings" },
        response: {
          extract_id: "extract_0123456789abcdef",
          results: [{ url: "https://investors.example.com/q4-2024", title: "Q4 2024", excerpts: ["Thank you. We delivered $1.1 billion of savings, ahead of our target. Next slide."] }],
        },
        urlFrom: "task-citation",
      },
    ],
  };
  const sheet = buildSheet({ company, windowStart: "2021-01-01", sheetRun: run, updates: [], fills: [fill], images: null, version: 1, builtAt: "2026-10-22T00:00:00Z" });
  assert.match(JSON.stringify(sheet), REQUEST_ID);
  const published = publicSheet(sheet);
  assert.doesNotMatch(JSON.stringify(published), REQUEST_ID);
  assert.deepEqual(
    published.runs.map((r) => [r.kind, r.spec, r.processor]),
    sheet.runs.map((r) => [r.kind, r.spec, r.processor]),
  );
  const filled = published.statements.find((s) => s.id === "EXM-P2-2025-01-20");
  assert.equal(filled?.verbatim?.backing.via, "extract");
  assert.equal(filled?.verbatim?.backing.extract?.objective, "savings");
  assert.equal(published.statements.length, sheet.statements.length);
});

test("a sentence too long to quote is cut at a clause break, still word for word", () => {
  const excerpt =
    "For fiscal 2026, we continue to expect: • Organic revenue to increase between 2 and 4 percent; • Core constant currency EPS to " +
    "increase between 4 and 6 percent; • A core annual effective tax rate of approximately 22 percent; • Capital spending to be below " +
    "5 percent of net revenue; and • A free cash flow conversion ratio of at least 80 percent, including the final tax payment made in " +
    "April related to the Tax Cuts and Jobs Act of 2017.";
  const found = findPassage(
    { quote: "Capital spending to be below 5 percent of net revenue", summary: "Capital spending below 5% of revenue.", topic: "capital spending" },
    [{ url: "https://investors.example.com/remarks.pdf", title: "Prepared remarks", excerpts: [excerpt] }],
    ["example.com"],
  );
  assert.ok(found);
  assert.equal(found.match, "exact");
  assert.ok(found.text.split(/\s+/).length <= MAX_QUOTE_WORDS);
  assert.ok(excerpt.includes(found.text));
});

test("published data has no request IDs and no quote over the limit", () => {
  const dir = new URL("../data/sheets/", import.meta.url);
  for (const file of readdirSync(dir)) {
    const raw = readFileSync(new URL(file, dir), "utf8");
    assert.doesNotMatch(raw, REQUEST_ID, file);
    const sheet = JSON.parse(raw) as SheetData;
    for (const s of sheet.statements) {
      if (s.verbatim) assert.ok(s.verbatim.text.split(/\s+/).length <= MAX_QUOTE_WORDS, `${s.id}: quote over ${MAX_QUOTE_WORDS} words`);
    }
  }
  assert.doesNotMatch(readFileSync(new URL("../data/profiles.json", import.meta.url), "utf8"), REQUEST_ID);
});
