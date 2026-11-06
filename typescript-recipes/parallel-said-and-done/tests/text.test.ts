import assert from "node:assert/strict";
import { test } from "node:test";

import { containsVerbatim, figureValues, keywords, markFigures, recall, sentences, substantiveFigures } from "../src/lib/text";

test("marks money ranges, percentages, fiscal periods and years as figures", () => {
  const segs = markFigures("We anticipate 2026 capital expenditures of $135-145 billion, up 39% from FY25 in Q3.");
  assert.deepEqual(
    segs.filter((s) => s.h).map((s) => s.t),
    ["2026", "$135-145 billion", "39%", "FY25", "Q3"],
  );
  assert.equal(segs.map((s) => s.t).join(""), "We anticipate 2026 capital expenditures of $135-145 billion, up 39% from FY25 in Q3.");
});

test("figure values compare across formatting", () => {
  assert.deepEqual([...figureValues("$135 billion-$145 billion")].sort(), ["135", "145"]);
  assert.deepEqual([...substantiveFigures("In Q3 2026 we spent $1,200 million")], ["1200"]);
});

test("sentences keep abbreviations and decimals", () => {
  assert.deepEqual(sentences("U.S. sales rose 3.5%. Margins held."), ["U.S. sales rose 3.5%.", "Margins held."]);
});

test("verbatim containment ignores case, curly quotes and spacing", () => {
  assert.ok(containsVerbatim("He said: “We’re  on track to close by June.” Then…", "we're on track to close by june"));
  assert.ok(!containsVerbatim("short", "short"));
});

test("keywords drop stopwords and stem lightly", () => {
  assert.deepEqual(keywords("We are expanding our datacenters"), ["expand", "datacenter"]);
  assert.equal(recall("double widget output", "Widget output will double"), 1);
});
