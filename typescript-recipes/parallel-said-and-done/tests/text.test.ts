import assert from "node:assert/strict";
import { test } from "node:test";

import { containsVerbatim, keywords, markFigures, quoteLength, recall, sentences, substantiveFigures } from "../src/lib/text";

test("marks money ranges, percentages, fiscal periods and years as figures", () => {
  const segs = markFigures("We anticipate 2026 capital expenditures of $135-145 billion, up 39% from FY25 in Q3.");
  assert.deepEqual(
    segs.filter((s) => s.h).map((s) => s.t),
    ["2026", "$135-145 billion", "39%", "FY25", "Q3"],
  );
  assert.equal(segs.map((s) => s.t).join(""), "We anticipate 2026 capital expenditures of $135-145 billion, up 39% from FY25 in Q3.");
});

test("figure values compare across formatting", () => {
  assert.deepEqual([...substantiveFigures("$135 billion-$145 billion")].sort(), ["USD:135000000000", "USD:145000000000"]);
  assert.deepEqual([...substantiveFigures("In Q3 2026 we spent $1,200 million")], ["USD:1200000000"]);
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

test("Chinese and Japanese sentences end at 。！？ and count as half a word per character", () => {
  assert.deepEqual(sentences("品牌正式进入中国。活动现场，嘉宾参观了系列产品！欢迎分享"), ["品牌正式进入中国。", "活动现场，嘉宾参观了系列产品！", "欢迎分享"]);
  assert.equal(quoteLength("品牌正式进入中国。"), 5);
  assert.equal(quoteLength("NikeSKIMS 在中国"), 3);
  assert.equal(quoteLength("Margins held at 12%."), 4);
});

test("exact matching keeps currencies distinct and does not match a numeric prefix", () => {
  assert.equal(containsVerbatim("Our guidance is £500 million annually.", "Our guidance is €500 million annually."), false);
  assert.equal(containsVerbatim("We raised guidance to 150 million.", "We raised guidance to 15"), false);
  assert.deepEqual(sentences("25 Boeing aircraft were delivered."), ["25 Boeing aircraft were delivered."]);
});
