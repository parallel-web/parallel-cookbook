/**
 * Notifications safety tests — finding 1 + finding 14:
 *  - A transient Slack/Email delivery failure must NOT flip the integration
 *    row to status="failed". Only explicit validation (recordTestResult)
 *    should ever do that.
 *  - markIntegrationUsed scopes its update by account_id (defense-in-depth
 *    against a stray cross-tenant integrationId).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ───────────────────────────────────────────────────────

vi.mock("@/lib/server/env", () => ({
  env: () => ({ APP_URL: "https://dashboard.example" }),
}));

type Row = Record<string, unknown>;
const integrations = new Map<string, Row>();
const accounts = new Map<string, Row>();

// Capture the last update payload + scope keys so tests can assert on it.
interface UpdateCapture {
  table: string;
  patch: Row;
  scope: Record<string, unknown>;
}
const updateLog: UpdateCapture[] = [];

const dbMock = vi.fn(() => ({
  from(table: string) {
    return tableBuilder(table);
  },
}));

function tableBuilder(table: string) {
  const scope: Record<string, unknown> = {};
  let updatePayload: Row | null = null;
  let selecting = false;
  return {
    select() {
      selecting = true;
      return this;
    },
    eq(col: string, val: unknown) {
      scope[col] = val;
      return this;
    },
    update(patch: Row) {
      updatePayload = patch;
      return this;
    },
    maybeSingle() {
      const map = bucket(table);
      let found: Row | undefined;
      for (const row of map.values()) {
        if (
          Object.entries(scope).every(([k, v]) => row[k] === v)
        ) {
          found = row;
          break;
        }
      }
      return Promise.resolve({ data: found ?? null, error: null });
    },
    then(onFulfilled?: (v: unknown) => unknown) {
      if (updatePayload) {
        // Apply the update scoped by every eq().
        const map = bucket(table);
        for (const row of map.values()) {
          if (
            Object.entries(scope).every(([k, v]) => row[k] === v)
          ) {
            Object.assign(row, updatePayload);
          }
        }
        updateLog.push({ table, patch: updatePayload, scope: { ...scope } });
        updatePayload = null;
      }
      void selecting;
      return Promise.resolve({ data: null, error: null }).then(onFulfilled);
    },
  };
}

function bucket(table: string): Map<string, Row> {
  if (table === "integrations") return integrations;
  if (table === "accounts") return accounts;
  throw new Error(`unexpected table ${table}`);
}

vi.mock("@/lib/server/db", () => ({ db: dbMock }));

const getActiveIntegration = vi.fn();
vi.mock("@/lib/server/integrations", async () => {
  const real = await vi.importActual<typeof import("@/lib/server/integrations")>(
    "@/lib/server/integrations",
  );
  return {
    ...real,
    getActiveIntegration,
  };
});

const postSlackMessage = vi.fn();
const sendResendEmail = vi.fn();
vi.mock("@/lib/server/providers", () => ({ postSlackMessage, sendResendEmail }));

beforeEach(() => {
  integrations.clear();
  accounts.clear();
  updateLog.length = 0;
  vi.clearAllMocks();
});

describe("notifyAssessment delivery safety", () => {
  it("transient Slack failure leaves the integration status active (finding 1)", async () => {
    accounts.set("acct-1", { id: "acct-1", email: "ops@example.com", display_name: "Ops" });
    integrations.set("int-slack", {
      id: "int-slack",
      account_id: "acct-1",
      provider: "slack",
      status: "active",
      metadata: { channel: "#alerts" },
    });
    getActiveIntegration.mockImplementation(async (accountId: string, provider: string) => {
      if (provider === "slack") return { id: "int-slack", account_id: accountId, secret: "xoxb-", metadata: { channel: "#alerts" } };
      return null;
    });
    postSlackMessage.mockResolvedValueOnce({ ok: false, error: "slack:rate_limited" });

    const { notifyAssessment } = await import("@/lib/server/notifications");
    await notifyAssessment({
      accountId: "acct-1",
      vendorName: "Acme",
      riskLevel: "CRITICAL",
      summary: "breach",
      url: "https://x",
    });

    // Status must still be active.
    expect(integrations.get("int-slack")?.status).toBe("active");
    // last_test_error should record the diagnostic but last_test_ok=false
    // and status untouched.
    const slackUpdate = updateLog.find(
      (u) => u.table === "integrations" && u.scope.id === "int-slack",
    );
    expect(slackUpdate?.patch.status).toBeUndefined();
    expect(slackUpdate?.patch.last_test_ok).toBe(false);
    expect(slackUpdate?.patch.last_test_error).toContain("slack");
    // Scoped by both id AND account_id (finding 14).
    expect(slackUpdate?.scope.account_id).toBe("acct-1");
  });

  it("transient Resend failure leaves the integration status active", async () => {
    accounts.set("acct-2", { id: "acct-2", email: "ops@example.com", display_name: null });
    integrations.set("int-email", {
      id: "int-email",
      account_id: "acct-2",
      provider: "email",
      status: "active",
      metadata: {},
    });
    getActiveIntegration.mockImplementation(async (accountId: string, provider: string) => {
      if (provider === "email") return { id: "int-email", account_id: accountId, secret: "re_xxx", metadata: {} };
      return null;
    });
    sendResendEmail.mockResolvedValueOnce({ ok: false, error: "Resend returned 503" });

    const { notifyAssessment } = await import("@/lib/server/notifications");
    await notifyAssessment({
      accountId: "acct-2",
      vendorName: "Acme",
      riskLevel: "HIGH",
      summary: "summary",
      url: "https://x",
    });

    expect(integrations.get("int-email")?.status).toBe("active");
    const emailUpdate = updateLog.find(
      (u) => u.table === "integrations" && u.scope.id === "int-email",
    );
    expect(emailUpdate?.patch.status).toBeUndefined();
    expect(emailUpdate?.patch.last_test_ok).toBe(false);
    expect(emailUpdate?.scope.account_id).toBe("acct-2");
  });

  it("successful Slack delivery only updates last_used_at, with account_id scope", async () => {
    accounts.set("acct-3", { id: "acct-3", email: null, display_name: null });
    integrations.set("int-slack-3", {
      id: "int-slack-3",
      account_id: "acct-3",
      provider: "slack",
      status: "active",
    });
    getActiveIntegration.mockImplementation(async (accountId: string, provider: string) => {
      if (provider === "slack") return { id: "int-slack-3", account_id: accountId, secret: "xoxb-", metadata: {} };
      return null;
    });
    postSlackMessage.mockResolvedValueOnce({ ok: true });

    const { notifyAssessment } = await import("@/lib/server/notifications");
    await notifyAssessment({
      accountId: "acct-3",
      vendorName: "Acme",
      riskLevel: "CRITICAL",
      summary: "summary",
    });

    const usedUpdate = updateLog.find(
      (u) => u.table === "integrations" && u.scope.id === "int-slack-3",
    );
    expect(usedUpdate?.patch.last_used_at).toBeDefined();
    expect(usedUpdate?.scope.account_id).toBe("acct-3");
  });
});
