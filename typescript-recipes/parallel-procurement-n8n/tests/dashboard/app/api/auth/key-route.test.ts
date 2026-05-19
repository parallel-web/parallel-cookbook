import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/crypto", () => ({
  sha256Hex: vi.fn(async (value: string) => `hash:${value}`),
}));

const setSessionCookie = vi.fn();
vi.mock("@/lib/server/session", () => ({ setSessionCookie }));

const addIntegration = vi.fn();
vi.mock("@/lib/server/integrations", () => ({ addIntegration }));

const testParallelKey = vi.fn();
vi.mock("@/lib/server/providers", () => ({ testParallelKey }));

type Row = Record<string, unknown>;
const accounts = new Map<string, Row>();
const integrations = new Map<string, Row>();
const accountUpdates: Array<{ id: string; patch: Row }> = [];
let nextAccountId = 1;

class Query {
  private readonly scope: Record<string, unknown> = {};
  private selected = "";
  private patch: Row | null = null;
  private insertRow: Row | null = null;

  constructor(private readonly table: string) {}

  select(columns?: string) {
    this.selected = columns ?? "";
    return this;
  }

  eq(col: string, value: unknown) {
    this.scope[col] = value;
    if (this.table === "accounts" && this.patch && col === "id") {
      accountUpdates.push({ id: String(value), patch: this.patch });
    }
    return this;
  }

  update(patch: Row) {
    this.patch = patch;
    return this;
  }

  insert(row: Row) {
    this.insertRow = row;
    return this;
  }

  maybeSingle() {
    const rows = this.table === "accounts" ? [...accounts.values()] : [...integrations.values()];
    const row = rows.find((candidate) =>
      Object.entries(this.scope).every(([key, value]) => candidate[key] === value),
    );
    return Promise.resolve({ data: row ?? null, error: null });
  }

  single() {
    if (this.table !== "accounts" || !this.insertRow) {
      return Promise.resolve({ data: null, error: new Error("Unexpected single call") });
    }
    const id = `acct-${nextAccountId++}`;
    const row = { id, ...this.insertRow };
    accounts.set(id, row);
    return Promise.resolve({
      data: this.selected.includes("id") ? { id } : row,
      error: null,
    });
  }
}

vi.mock("@/lib/server/db", () => ({
  db: () => ({
    from(table: string) {
      return new Query(table);
    },
  }),
}));

beforeEach(() => {
  accounts.clear();
  integrations.clear();
  accountUpdates.length = 0;
  nextAccountId = 1;
  setSessionCookie.mockClear();
  addIntegration.mockReset();
  addIntegration.mockResolvedValue({ id: "int-new" });
  testParallelKey.mockReset();
  testParallelKey.mockResolvedValue({ ok: true });
});

async function callSignin(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/auth/key/route");
  const req = new Request("https://dashboard.example/api/auth/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req as never);
}

describe("POST /api/auth/key", () => {
  it("signs in an existing account when the Parallel key hash is already bound", async () => {
    accounts.set("acct-1", {
      id: "acct-1",
      email_hash: "hash:buyer@example.com",
      onboarded_at: "2026-01-01T00:00:00.000Z",
    });
    integrations.set("int-1", {
      id: "int-1",
      account_id: "acct-1",
      provider: "parallel",
      secret_hash: "hash:parallel-existing-key",
      status: "active",
    });

    const res = await callSignin({
      email: "buyer@example.com",
      apiKey: "parallel-existing-key",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, next: "/" });
    expect(setSessionCookie).toHaveBeenCalledWith({ accountId: "acct-1" });
    expect(addIntegration).not.toHaveBeenCalled();
  });

  it("rejects an existing account when the key is valid but not bound to that account", async () => {
    accounts.set("acct-1", {
      id: "acct-1",
      email_hash: "hash:buyer@example.com",
      onboarded_at: null,
    });
    integrations.set("int-1", {
      id: "int-1",
      account_id: "acct-1",
      provider: "parallel",
      secret_hash: "hash:parallel-real-owner-key",
      status: "active",
    });

    const res = await callSignin({
      email: "buyer@example.com",
      apiKey: "parallel-attacker-key",
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Email or Parallel API key is incorrect",
    });
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(addIntegration).not.toHaveBeenCalled();
    expect(accountUpdates).toEqual([]);
  });

  it("returns the same generic error for a bad Parallel key on an unknown email", async () => {
    testParallelKey.mockResolvedValueOnce({ ok: false, error: "Parallel rejected this key" });

    const res = await callSignin({
      email: "stranger@example.com",
      apiKey: "parallel-bad-key",
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Email or Parallel API key is incorrect",
    });
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(addIntegration).not.toHaveBeenCalled();
  });

  it("returns the same generic error for a bad Parallel key on a known email", async () => {
    accounts.set("acct-1", {
      id: "acct-1",
      email_hash: "hash:buyer@example.com",
      onboarded_at: "2026-01-01T00:00:00.000Z",
    });
    testParallelKey.mockResolvedValueOnce({ ok: false, error: "Parallel rejected this key" });

    const res = await callSignin({
      email: "buyer@example.com",
      apiKey: "parallel-bad-key",
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Email or Parallel API key is incorrect",
    });
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(addIntegration).not.toHaveBeenCalled();
  });

  it("creates a new account and stores the first Parallel integration", async () => {
    const res = await callSignin({
      email: "new@example.com",
      apiKey: "parallel-new-key",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, next: "/onboarding/profile" });
    expect(addIntegration).toHaveBeenCalledWith({
      accountId: "acct-1",
      provider: "parallel",
      secret: "parallel-new-key",
      label: "default",
      makeDefault: true,
      actor: "system",
    });
    expect(setSessionCookie).toHaveBeenCalledWith({ accountId: "acct-1" });
  });
});
