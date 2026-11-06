import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("a call and separate Monitor events on the same date survive writes and retries", async () => {
  const root = mkdtempSync(join(tmpdir(), "said-done-events-"));
  const { fileStorage, useStorage } = await import("../src/storage");
  useStorage(fileStorage(root));
  const { newRecord } = await import("../src/updates/update");
  const { readCallDay, writeCallDay, listCallDays } = await import("../src/store");
  const call = newRecord("EXM", "2026-11-05", "Q3", { kind: "manual", monitorId: null, eventId: null, eventGroupId: null, eventDate: null, content: null, citations: [] });
  const announcement = { ...call, kind: "event" as const, trigger: { ...call.trigger, kind: "monitor" as const, eventId: "event-a" } };
  const dir = join(root, "output", "callday");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "EXM-2026-11-05.json"), JSON.stringify(announcement));
  assert.equal(await readCallDay(call.ticker, call.callDate), null);
  assert.deepEqual(await readCallDay(call.ticker, call.callDate, "event-a"), announcement);
  await writeCallDay(call);
  await writeCallDay({ ...announcement, trigger: { ...announcement.trigger, eventId: "event-b" } });
  await writeCallDay(announcement);
  assert.deepEqual(await readCallDay(call.ticker, call.callDate), call);
  assert.deepEqual(await readCallDay(call.ticker, call.callDate, "event-a"), announcement);
  assert.equal((await listCallDays()).length, 3);
});
