import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { POST } from "../src/app/api/webhooks/parallel/route";

test("the webhook rejects unsigned, stale and altered deliveries before dispatch", async () => {
  process.env.PARALLEL_API_KEY = "test";
  const key = Buffer.from("fixture signing key");
  const body = JSON.stringify({ type: "monitor.execution.completed" });
  const post = (headers: Record<string, string>, payload = body) =>
    POST(new Request("https://example.test", { method: "POST", headers, body: payload }));
  const signed = (ts: number) => {
    const sig = createHmac("sha256", key).update(`evt_test.${ts}.${body}`).digest("base64");
    return { "webhook-id": "evt_test", "webhook-timestamp": String(ts), "webhook-signature": `v1,old v1,${sig}` };
  };
  const now = Math.floor(Date.now() / 1000);
  delete process.env.PARALLEL_WEBHOOK_SECRET;
  assert.equal((await post(signed(now))).status, 503);
  process.env.PARALLEL_WEBHOOK_SECRET = `whsec_${key.toString("base64")}`;
  const forged = JSON.stringify({ type: "task_run.status", data: { run_id: "trun_invented" } });
  assert.equal((await post({}, forged)).status, 401);
  assert.equal((await post(signed(now), forged)).status, 401);
  for (const ts of [now - 3600, now + 3600]) assert.equal((await post(signed(ts))).status, 401);
  assert.equal((await post(signed(now))).status, 200);
});
