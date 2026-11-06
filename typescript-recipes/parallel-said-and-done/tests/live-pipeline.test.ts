import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Parallel from "parallel-web";

import type { StoredRun } from "../src/parallel/task";
import { onRunComplete } from "../src/pipeline/advance";
import { drive } from "../src/pipeline/drive";
import { reconcile } from "../src/pipeline/reconcile";
import { startRun } from "../src/pipeline/runs";
import { completeSheet } from "../src/sheet/make-sheet";
import { readManifest, writeManifest, type Manifest } from "../src/sheet/stored";
import { fileStorage, useStorage as setStorage } from "../src/storage";
import { companyFor, readInflight, readMonitor, readPublishedSheet, writeInflight, writeRaw } from "../src/store";
import { cancelMonitors, createMonitors, replaceMissing } from "../src/updates/monitors";

const ticker = "MSFT";
const sheetFile = new URL("../data/sheets/MSFT.json", import.meta.url);
const fixture: StoredRun = JSON.parse(readFileSync(new URL("./fixtures/sheet-run.json", import.meta.url), "utf8"));
const initial: Manifest = { sheetRunId: "trun_register", images: false, taskGroupId: null, updates: [] };
const quiet = () => {};
function freshStore() {
  const store = fileStorage(mkdtempSync(join(tmpdir(), "said-done-live-")));
  setStorage(store);
  return store;
}

async function liveStore() {
  const store = freshStore();
  const snapshot = JSON.parse(readFileSync(sheetFile, "utf8"));
  await store.put("data/sheets/MSFT.json", JSON.stringify(snapshot));
  snapshot.runs[0].runId = initial.sheetRunId;
  await store.put("output/sheets/MSFT.json", JSON.stringify(snapshot));
  await writeRaw(ticker, "manifest", "latest", initial); // Existing installations.
  return store;
}

test("reconcile never enrolls a company just because the store is empty or contains a public snapshot", async () => {
  const store = freshStore();
  const requests: string[] = [];
  const client = new Parallel({ apiKey: "test", maxRetries: 0, fetch: async url => {
    requests.push(String(url));
    return Response.json({}, { status: 400 });
  } });
  await reconcile(client, { log: quiet });
  await store.put("data/sheets/MSFT.json", readFileSync(sheetFile, "utf8"));
  await reconcile(client, { log: quiet });
  assert.deepEqual(requests, []);
});

test("a held replacement keeps the published register active", async () => {
  const store = await liveStore();
  const before = await readPublishedSheet(ticker);
  const client = new Parallel({ apiKey: "test", fetch: async () => Response.json({ results: [] }) });
  const candidate = await completeSheet(client, companyFor(ticker), fixture, { trigger: "rerun", images: false, log: quiet });
  assert.equal(candidate.published, false);
  assert.deepEqual(await readManifest(ticker), initial);
  assert.deepEqual(await readPublishedSheet(ticker), before);
  assert.equal((await store.list("output/drafts/")).length, 1);
});

test("only a quality run from the published register can change its manifest", async () => {
  const store = await liveStore();
  const client = new Parallel({ apiKey: "test", fetch: async url => Response.json(String(url).endsWith("/result")
    ? fixture.result
    : { ...fixture.run, metadata: { app: "said-and-done", ticker } }) });
  const current = { ...initial, sheetRunId: "trun_replacement" };
  const stage = { promise: "P1", sheetRunId: initial.sheetRunId };
  await startRun(client, ticker, "trail-run", { input: {}, processor: "ultra4x" }, "trail@1", { stage });
  const inflight = await readInflight(ticker);
  const old = inflight[fixture.run.run_id];
  // A second pending run keeps the planner from scheduling unrelated work in this test.
  await writeInflight(ticker, { ...inflight, legacy: { kind: "trail-run", spec: "trail@1", promise: "P1", startedAt: old.startedAt },
    pending: { kind: "profile-run", spec: "profile@2", startedAt: old.startedAt } });
  await writeManifest(ticker, current);
  const sheet = JSON.parse((await store.get("output/sheets/MSFT.json"))!);
  sheet.runs[0].runId = current.sheetRunId;
  await store.put("output/sheets/MSFT.json", JSON.stringify(sheet));
  for (const id of [fixture.run.run_id, "legacy"]) await onRunComplete(client, id, quiet);
  assert.deepEqual(await readManifest(ticker), current);
  assert.deepEqual(Object.keys(await readInflight(ticker)), ["pending"]);

  await startRun(client, ticker, "trail-run", { input: {}, processor: "ultra4x" }, "trail@1", { stage: { promise: "P1", sheetRunId: current.sheetRunId } });
  await onRunComplete(client, fixture.run.run_id, quiet);
  assert.equal((await readManifest(ticker))?.trails?.P1, fixture.run.run_id);
});

test("two creators share one monitor and a stale repair cannot undo a cancellation", async () => {
  await liveStore();
  const requests: string[] = [];
  const client = new Parallel({ apiKey: "test", fetch: async url => {
    requests.push(new URL(String(url)).pathname);
    return Response.json({ monitor_id: "mon_test" });
  } });
  await Promise.all([createMonitors(client, [ticker], quiet), createMonitors(client, [ticker], quiet)]);
  const beforeCancel = await readMonitor(ticker);
  assert.ok(beforeCancel);
  await cancelMonitors(client, [ticker], quiet);
  await replaceMissing(client, beforeCancel, quiet);
  assert.deepEqual(requests, ["/v1/monitors", "/v1/monitors/mon_test/cancel"]);
  assert.ok((await readMonitor(ticker))?.cancelledAt);
});

test("a lost Task creation response never resubmits the paid request", async () => {
  freshStore();
  let posts = 0;
  const client = new Parallel({ apiKey: "test", maxRetries: 1, fetch: async () => {
    posts++;
    if (posts === 1) throw new TypeError("connection closed after acceptance");
    return Response.json(fixture.run);
  } });
  await assert.rejects(startRun(client, ticker, "sheet-run", { input: {}, processor: "ultra2x" }, "sheet@1"));
  assert.equal(posts, 1);
  assert.deepEqual(await readInflight(ticker), {});
});

test("the local driver reports a history submission failure after the baseline publishes", async () => {
  await liveStore();
  const id = initial.sheetRunId;
  const run = { ...fixture.run, run_id: id, metadata: { app: "said-and-done", ticker } };
  await writeInflight(ticker, { [id]: { kind: "sheet-run", spec: fixture.spec, startedAt: new Date().toISOString() } });
  const client = new Parallel({ apiKey: "test", fetch: async url => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/result")) return Response.json({ ...fixture.result, run });
    if (path.endsWith(id)) return Response.json(run);
    if (path.endsWith("/monitors")) return Response.json({ monitor_id: "mon_test" });
    assert.equal(path, "/v1/tasks/runs");
    return Response.json({ error: { message: "Insufficient credit for history" } }, { status: 402 });
  } });
  await assert.rejects(drive(client, [ticker], quiet), /402.*Insufficient credit for history/);
  assert.deepEqual(await readInflight(ticker), {});
  assert.equal((await readMonitor(ticker))?.monitorId, "mon_test");
});
