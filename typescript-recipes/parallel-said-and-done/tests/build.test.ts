import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildSheet } from "../src/sheet/build";
import type { FillRecord } from "../src/sheet/fill";
import { tierOf } from "../src/sheet/evidence";
import type { StoredRun } from "../src/parallel/task";

const run = JSON.parse(readFileSync(new URL("./fixtures/sheet-run.json", import.meta.url), "utf8")) as StoredRun;
const company = { ticker: "EXM", name: "Example Corp", short: "Example", website: "example.com" };
const build = (fills: FillRecord[] = []) =>
  buildSheet({ company, windowStart: "2021-01-01", sheetRun: run, updates: [], fills, images: null, version: 1, builtAt: "2026-10-22T00:00:00Z" });

test("statements are backed only by text found in their own citations", () => {
  const sheet = build();
  const byId = Object.fromEntries(sheet.statements.map((s) => [s.id, s]));
  assert.equal(byId["EXM-P1-2023-01-20"].verbatim?.match, "exact");
  assert.equal(byId["EXM-P1-2023-01-20"].verbatim?.text, "We will double widget output to 2 million units by 2025.");
  assert.equal(byId["EXM-P1-2023-01-20"].verbatim?.backing.tier, "primary");
  assert.equal(byId["EXM-P1-2024-07-20"].verbatim?.backing.tier, "press");
  // No quote, but the summary matches the cited excerpt with the same figure.
  assert.equal(byId["EXM-P2-2023-04-20"].verbatim?.match, "matched");
  // The cited news excerpt does not carry the quote: shown as the Task summary.
  assert.equal(byId["EXM-P2-2025-01-20"].verbatim, null);
  assert.equal(byId["EXM-P3-2024-04-20"].k, "x");
});

test("out-of-window statements are dropped and reported by the gate", () => {
  const sheet = build();
  assert.ok(!sheet.statements.some((s) => s.date === "2030-01-01"));
  const dates = sheet.gate.checks.find((c) => c.id === "dates");
  assert.equal(dates?.result, "warn");
});

test("an Extract fill backs a statement the Task could not", () => {
  const fill: FillRecord = {
    statementId: "EXM-P2-2025-01-20",
    runId: "trun_fixture",
    createdAt: "2026-10-22T00:00:00Z",
    steps: [
      {
        kind: "extract",
        request: { objective: "savings" },
        response: {
          extract_id: "extract_fixture",
          results: [{ url: "https://investors.example.com/q4-2024", title: "Q4 2024", excerpts: ["Thank you. We delivered $1.1 billion of savings, ahead of our target. Next slide."] }],
        },
        urlFrom: "task-citation",
      },
    ],
  };
  const s = build([fill]).statements.find((x) => x.id === "EXM-P2-2025-01-20");
  assert.equal(s?.verbatim?.backing.via, "extract");
  assert.equal(s?.verbatim?.backing.extract?.id, "extract_fixture");
  assert.equal(s?.verbatim?.match, "exact");
});

test("full page text from Extract backs a quote whose cited excerpt was cut off", () => {
  const fill: FillRecord = {
    statementId: "EXM-P5-2025-10-20",
    runId: "trun_fixture",
    createdAt: "2026-10-22T00:00:00Z",
    steps: [
      {
        kind: "extract",
        request: { objective: "Ohio" },
        response: {
          extract_id: "extract_full",
          results: [
            {
              url: "https://investors.example.com/q3-2025.pdf",
              title: "Q3 2025 transcript",
              excerpts: ["Ohio construction continues and we"],
              full_content: "Operator: welcome.\nAnn Lee: Ohio construction continues and we now see opening in 2027. Thank you.",
            },
          ],
        },
        urlFrom: "task-citation",
      },
    ],
  };
  const s = build([fill]).statements.find((x) => x.id === "EXM-P5-2025-10-20");
  assert.equal(s?.verbatim?.text, "Ann Lee: Ohio construction continues and we now see opening in 2027.");
  assert.equal(s?.verbatim?.match, "exact");
});

test("source tiers come from the company domains", () => {
  const own = ["example.com"];
  assert.equal(tierOf("https://investors.example.com/x", own), "primary");
  assert.equal(tierOf("https://www.sec.gov/x", own), "primary");
  assert.equal(tierOf("https://www.fool.com/earnings/x", own), "transcript");
  assert.equal(tierOf("https://news.example.org/x", own), "press");
});

test("sources are ranked by promises supported", () => {
  const sheet = build();
  assert.equal(sheet.sources[0].url, "https://investors.example.com/q4-2022-transcript");
  assert.equal(sheet.sources[0].uses, "P1");
});
