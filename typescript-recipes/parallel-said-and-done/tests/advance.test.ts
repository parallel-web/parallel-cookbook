import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { FactCheck, SheetData } from "../src/lib/types";
import type { StoredRun } from "../src/parallel/task";
import { planNext } from "../src/pipeline/advance";
import { buildSheet } from "../src/sheet/build";
import type { Manifest } from "../src/sheet/stored";
import { fileStorage, useStorage } from "../src/storage";
import { withLock } from "../src/store";

const run = JSON.parse(readFileSync(new URL("./fixtures/sheet-run.json", import.meta.url), "utf8")) as StoredRun;
const company = { ticker: "EXM", name: "Example Corp", short: "Example", website: "example.com" };
const base = buildSheet({ company, windowStart: "2021-01-01", sheetRun: run, updates: [], fills: [], images: null, version: 1, builtAt: "2026-10-22T00:00:00Z" });
const ids = base.promises.map((p) => p.id);
const all = (v: string) => Object.fromEntries(ids.map((id) => [id, `${v}_${id}`]));
const manifest = (m: Partial<Manifest> = {}): Manifest => ({ sheetRunId: "trun_sheet", taskGroupId: null, updates: [], images: false, ...m });
const check = (verdict: FactCheck["verdict"], checks = 1): FactCheck => ({ verdict, status: "open", summaryErrors: [], held: 0, missing: [], checks, agree: checks });
const withChecks = (f: (pid: string) => FactCheck | null): SheetData => ({ ...base, promises: base.promises.map((p) => ({ ...p, factCheck: f(p.id) })) });

test("a new sheet gets a history for every promise first", () => {
  const steps = planNext(manifest(), withChecks(() => null));
  assert.deepEqual(steps, ids.map((pid) => ({ kind: "trail-run", promise: pid })));
});

test("with histories in place, every outcome without a current check gets one", () => {
  const steps = planNext(manifest({ trails: all("trail") }), withChecks((pid) => (pid === ids[0] ? check("correct") : null)));
  assert.deepEqual(steps, ids.slice(1).map((pid) => ({ kind: "check-run", promise: pid })));
});

test("a single disputing check is put to a vote of two more", () => {
  const steps = planNext(manifest({ trails: all("trail") }), withChecks((pid) => (pid === ids[1] ? check("unclear") : check("correct"))));
  assert.deepEqual(steps, [{ kind: "check-run", promise: ids[1] }, { kind: "check-run", promise: ids[1] }]);
});

test("an outcome most checks dispute is resolved once, and then left alone", () => {
  const disputed = withChecks((pid) => (pid === ids[2] ? check("incorrect", 3) : check("correct")));
  assert.deepEqual(planNext(manifest({ trails: all("trail") }), disputed), [{ kind: "resolve-run", promise: ids[2] }]);
  const resolved = manifest({ trails: all("trail"), resolves: { [ids[2]]: "trun_resolve" } });
  assert.deepEqual(planNext(resolved, withChecks((pid) => (pid === ids[2] ? check("incorrect") : check("correct")))), []);
});

test("a step that failed twice is not retried automatically", () => {
  const steps = planNext(manifest({ failures: { [`trail-run:${ids[0]}`]: 2 } }), withChecks(() => null));
  assert.ok(!steps.some((s) => s.promise === ids[0]));
  assert.equal(steps.length, ids.length - 1);
});

test("a fully checked sheet needs nothing", () => {
  assert.deepEqual(planNext(manifest({ trails: all("trail") }), withChecks(() => check("correct", 3))), []);
});

test("one company's state changes happen one at a time", async () => {
  useStorage(fileStorage(mkdtempSync(join(tmpdir(), "said-and-done-"))));
  const order: string[] = [];
  const job = (name: string) => withLock("EXM", async () => {
    order.push(`${name} start`);
    await new Promise((r) => setTimeout(r, 50));
    order.push(`${name} end`);
  });
  await Promise.all([job("a"), job("b")]);
  assert.deepEqual(order.map((x) => x.split(" ")[1]), ["start", "end", "start", "end"]);
});
