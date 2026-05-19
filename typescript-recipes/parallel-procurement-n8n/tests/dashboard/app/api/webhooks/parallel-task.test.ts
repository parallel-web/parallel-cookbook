/**
 * Tests for the parallel-task webhook handler. Covers:
 *   - BYOK token verification (missing / wrong scope / valid)
 *   - Unknown run race (returns 503 + Retry-After so Parallel redelivers)
 *   - status==="completed" with 404 result leaves status="running" for
 *     cron/sweep to reconcile (finding 10)
 *   - status==="completed" with a real result body persists the assessment
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── env stub: webhook-token reads env().PARALLEL_WEBHOOK_SECRET ────────
vi.mock("@/lib/server/env", () => {
  return {
    env: () => ({
      PARALLEL_WEBHOOK_SECRET: "test-secret-do-not-use-in-prod-1234567890",
      PARALLEL_BASE_URL: "https://api.parallel.example",
      APP_URL: "https://dashboard.example",
      PARALLEL_RESEARCH_PROCESSOR: "ultra8x",
    }),
  };
});

// ── db stub: in-memory rows so we don't need Supabase ──────────────────
type Row = Record<string, unknown>;
const db = {
  risk_assessments: new Map<string, Row>(),
  integrations: new Map<string, Row>(),
  insertOrder: 0,
};

const dbMock = vi.fn(() => ({
  from(table: string) {
    return tableBuilder(table);
  },
}));

function tableBuilder(table: string) {
  let query: { col?: string; val?: unknown } = {};
  let updatePayload: Row | null = null;
  return {
    select(_cols?: string) {
      return this;
    },
    eq(col: string, val: unknown) {
      query = { col, val };
      return this;
    },
    in() {
      return this;
    },
    or() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    insert(row: Row) {
      const id = `${table}-${++db.insertOrder}`;
      const stored = { id, ...row };
      bucket(table).set(id, stored);
      return Promise.resolve({ data: stored, error: null });
    },
    upsert(row: Row, _opts?: unknown) {
      const id = (row.id as string) ?? `${table}-${++db.insertOrder}`;
      const stored = { id, ...row };
      bucket(table).set(id, stored);
      return Promise.resolve({ data: stored, error: null });
    },
    update(patch: Row) {
      updatePayload = patch;
      return this;
    },
    maybeSingle() {
      const found = findRow(table, query);
      return Promise.resolve({ data: found ?? null, error: null });
    },
    single() {
      const found = findRow(table, query);
      return Promise.resolve({ data: found ?? null, error: found ? null : { message: "not found" } });
    },
    // terminal await for update().eq(...) chains
    then(onFulfilled?: (v: unknown) => unknown) {
      if (updatePayload && query.col && query.val !== undefined) {
        const found = findRow(table, query);
        if (found) Object.assign(found, updatePayload);
        updatePayload = null;
        return Promise.resolve({ data: found ?? null, error: null }).then(onFulfilled);
      }
      return Promise.resolve({ data: null, error: null }).then(onFulfilled);
    },
  };
}

function bucket(table: string): Map<string, Row> {
  const map = (db as unknown as Record<string, Map<string, Row>>)[table];
  if (!map) throw new Error(`unexpected table ${table}`);
  return map;
}

function findRow(table: string, q: { col?: string; val?: unknown }): Row | undefined {
  if (!q.col) return undefined;
  for (const row of bucket(table).values()) {
    if (row[q.col] === q.val) return row;
  }
  return undefined;
}

vi.mock("@/lib/server/db", () => ({ db: dbMock }));

// ── integrations stub ──────────────────────────────────────────────────
vi.mock("@/lib/server/integrations", () => ({
  getActiveIntegration: vi.fn(async (accountId: string) => ({
    id: `int-${accountId}`,
    account_id: accountId,
    secret: "pk-test",
  })),
  markIntegrationUsed: vi.fn(async () => undefined),
}));

// ── ParallelTaskClient stub ────────────────────────────────────────────
const taskClient = { getRunResult: vi.fn() };
vi.mock("@/lib/parallel/task-client", () => ({
  ParallelTaskClient: vi.fn().mockImplementation(function () {
    return taskClient;
  }),
}));

// ── persistAssessmentForRun stub ───────────────────────────────────────
const persistAssessmentForRun = vi.fn(async () => undefined);
vi.mock("@/lib/server/research", () => ({ persistAssessmentForRun }));

// ── token helper using the SAME secret as the route module ─────────────
async function tokenFor(scope: string): Promise<string> {
  const secret = "test-secret-do-not-use-in-prod-1234567890";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(scope));
  const bytes = new Uint8Array(sig);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// next/server's NextRequest wraps Request — the handler reads
// `request.nextUrl.searchParams.get("t")`.
async function callHandler(url: string, body: unknown) {
  const { POST } = await import("@/app/api/webhooks/parallel-task/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(buildRequest(url, body));
  return POST(req);
}

beforeEach(() => {
  db.risk_assessments.clear();
  db.integrations.clear();
  db.insertOrder = 0;
  vi.clearAllMocks();
  taskClient.getRunResult.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("parallel-task webhook", () => {
  it("returns 401 when token is missing", async () => {
    const res = await callHandler("https://dashboard.example/api/webhooks/parallel-task", {
      data: { run_id: "run_1", status: "completed" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is from the wrong scope", async () => {
    const monitorToken = await tokenFor("monitor");
    const res = await callHandler(
      `https://dashboard.example/api/webhooks/parallel-task?t=${monitorToken}`,
      { data: { run_id: "run_1", status: "completed" } },
    );
    expect(res.status).toBe(401);
  });

  it("returns 503 with Retry-After when assessment row hasn't been persisted yet (race)", async () => {
    const t = await tokenFor("research");
    const res = await callHandler(
      `https://dashboard.example/api/webhooks/parallel-task?t=${t}`,
      { data: { run_id: "run_not_persisted_yet", status: "completed" } },
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = (await res.json()) as { ok: boolean; retry: boolean };
    expect(body.ok).toBe(false);
    expect(body.retry).toBe(true);
  });

  it("leaves status=running and returns deferred when result fetch yields null (404)", async () => {
    db.risk_assessments.set("a-1", {
      id: "a-1",
      account_id: "acct-1",
      vendor_id: "v-1",
      parallel_run_id: "run_404",
      status: "running",
    });
    taskClient.getRunResult.mockResolvedValueOnce(null);

    const t = await tokenFor("research");
    const res = await callHandler(
      `https://dashboard.example/api/webhooks/parallel-task?t=${t}`,
      { data: { run_id: "run_404", status: "completed" } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deferred?: boolean };
    expect(body.deferred).toBe(true);
    // Row stays running so cron/sweep reconciles it.
    expect(db.risk_assessments.get("a-1")?.status).toBe("running");
    expect(persistAssessmentForRun).not.toHaveBeenCalled();
  });

  it("persists the assessment when result fetch succeeds", async () => {
    db.risk_assessments.set("a-2", {
      id: "a-2",
      account_id: "acct-2",
      vendor_id: "v-2",
      parallel_run_id: "run_ok",
      status: "running",
    });
    taskClient.getRunResult.mockResolvedValueOnce({
      output: {
        content: { vendor_name: "Acme" },
        basis: [{ field: "cybersecurity", confidence: "high", citations: [{ url: "https://x" }] }],
      },
    });

    const t = await tokenFor("research");
    const res = await callHandler(
      `https://dashboard.example/api/webhooks/parallel-task?t=${t}`,
      { data: { run_id: "run_ok", status: "completed" } },
    );

    expect(res.status).toBe(200);
    expect(persistAssessmentForRun).toHaveBeenCalledOnce();
    const call = persistAssessmentForRun.mock.calls[0][0] as { runId: string; vendorId: string };
    expect(call.runId).toBe("run_ok");
    expect(call.vendorId).toBe("v-2");
  });
});
