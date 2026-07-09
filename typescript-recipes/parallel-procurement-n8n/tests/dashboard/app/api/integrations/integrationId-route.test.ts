/**
 * PATCH /api/integrations/[integrationId] validation tests (finding 13):
 *  - rotating with a bogus secret returns 422 and doesn't touch the row
 *  - rotating with a good secret runs testProviderKey first, then persists
 *  - validate=false skips the test (escape hatch for offline rotations)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/server/env", () => ({
  env: () => ({ PARALLEL_BASE_URL: "https://api.parallel.example", APP_URL: "https://x" }),
}));

// db stub — only the rows we set up in `integrations` are visible.
type Row = Record<string, unknown>;
const integrations = new Map<string, Row>();
const dbCalls: string[] = [];

vi.mock("@/lib/server/db", () => ({
  db: () => ({
    from(table: string) {
      dbCalls.push(`from:${table}`);
      const scope: Record<string, unknown> = {};
      return {
        select() {
          return this;
        },
        eq(col: string, val: unknown) {
          scope[col] = val;
          return this;
        },
        maybeSingle() {
          if (table !== "integrations") return Promise.resolve({ data: null, error: null });
          for (const row of integrations.values()) {
            if (Object.entries(scope).every(([k, v]) => row[k] === v)) {
              return Promise.resolve({ data: row, error: null });
            }
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  }),
}));

// Account stub
vi.mock("@/lib/server/account", () => ({
  requireAccount: vi.fn(async () => ({ id: "acct-1", email: "ops@example.com" })),
  HttpError: class HttpError extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.status = status;
    }
  },
}));

// rotateIntegration stub — assert NOT called on validation failure.
const rotateIntegration = vi.fn(async (input) => ({ id: input.integrationId, status: "active" }));
const updateIntegrationMetadata = vi.fn();
const deleteIntegration = vi.fn();
vi.mock("@/lib/server/integrations", async () => {
  return {
    rotateIntegration,
    updateIntegrationMetadata,
    deleteIntegration,
  };
});

// testProviderKey stub
const testProviderKey = vi.fn();
vi.mock("@/lib/server/providers", () => ({ testProviderKey }));

beforeEach(() => {
  integrations.clear();
  integrations.set("int-1", { id: "int-1", account_id: "acct-1", provider: "slack" });
  rotateIntegration.mockClear();
  testProviderKey.mockReset();
  dbCalls.length = 0;
});

async function callPatch(integrationId: string, body: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/integrations/[integrationId]/route");
  const req = new Request(`https://x/api/integrations/${integrationId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ integrationId }) });
}

describe("PATCH /api/integrations/[integrationId]", () => {
  it("returns 422 and doesn't rotate when validation fails (bogus key)", async () => {
    testProviderKey.mockResolvedValueOnce({ ok: false, error: "Slack rejected token (401)" });

    const res = await callPatch("int-1", { secret: "xoxb-bogus" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Slack");
    expect(rotateIntegration).not.toHaveBeenCalled();
  });

  it("rotates when validation succeeds", async () => {
    testProviderKey.mockResolvedValueOnce({ ok: true, detail: "ok" });

    const res = await callPatch("int-1", { secret: "xoxb-good" });
    expect(res.status).toBe(200);
    expect(testProviderKey).toHaveBeenCalledWith("slack", "xoxb-good");
    expect(rotateIntegration).toHaveBeenCalledOnce();
  });

  it("returns 404 when the integration row doesn't belong to the account", async () => {
    const res = await callPatch("int-not-mine", { secret: "xoxb-anything" });
    expect(res.status).toBe(404);
    expect(testProviderKey).not.toHaveBeenCalled();
    expect(rotateIntegration).not.toHaveBeenCalled();
  });

  it("validate=false skips testProviderKey and rotates directly", async () => {
    const res = await callPatch("int-1", { secret: "xoxb-offline", validate: false });
    expect(res.status).toBe(200);
    expect(testProviderKey).not.toHaveBeenCalled();
    expect(rotateIntegration).toHaveBeenCalledOnce();
  });
});
