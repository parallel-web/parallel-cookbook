/**
 * deployMonitorsForVendor rollback tests (finding 9):
 *  - On DB upsert failure, we cancel the remote monitor so we don't leave
 *    a billed-but-invisible ghost in the fleet.
 *  - If cancel also fails, we log an `audit_log` row so an operator can
 *    reconcile manually.
 *  - Successful deploys still record + return the DeployedMonitor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/server/env", () => ({
  env: () => ({ PARALLEL_BASE_URL: "https://api.parallel.example", APP_URL: "https://dashboard.example", PARALLEL_WEBHOOK_SECRET: "secret" }),
}));

// Capture monitor + audit_log table writes.
interface Capture {
  table: string;
  op: "upsert" | "insert";
  payload: Record<string, unknown>;
}
const writes: Capture[] = [];
let nextUpsertError: Error | null = null;

vi.mock("@/lib/server/db", () => ({
  db: () => ({
    from(table: string) {
      return {
        upsert(payload: Record<string, unknown>, _opts?: unknown) {
          writes.push({ table, op: "upsert", payload });
          if (table === "monitors" && nextUpsertError) {
            const err = nextUpsertError;
            nextUpsertError = null;
            return Promise.resolve({ error: err });
          }
          return Promise.resolve({ error: null });
        },
        insert(payload: Record<string, unknown>) {
          writes.push({ table, op: "insert", payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  }),
}));

vi.mock("@/lib/server/webhook-token", () => ({
  monitorWebhookUrl: vi.fn(async () => "https://dashboard.example/api/webhooks/parallel-monitor?t=abc"),
}));

const createMonitor = vi.fn();
const cancelMonitor = vi.fn();
vi.mock("@/lib/parallel/monitor-client", () => ({
  ParallelMonitorClient: vi.fn().mockImplementation(function () {
    return { createMonitor, cancelMonitor };
  }),
}));

beforeEach(() => {
  writes.length = 0;
  nextUpsertError = null;
  vi.clearAllMocks();
});

function vendor(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "v-1",
    account_id: "acct-1",
    vendor_name: "Acme",
    vendor_domain: "acme.com",
    vendor_category: "saas",
    relationship_owner: null,
    region: null,
    monitoring_priority: "high",
    risk_tier_override: null,
    next_research_date: "2026-05-19",
    created_at: "",
    updated_at: "",
    ...overrides,
  } as never;
}

describe("deployMonitorsForVendor", () => {
  it("rolls back the remote monitor when DB upsert fails (finding 9)", async () => {
    let count = 0;
    createMonitor.mockImplementation(async () => ({ monitor_id: `mon-${++count}` }));
    cancelMonitor.mockResolvedValue(undefined);

    // First DB upsert fails, subsequent ones succeed.
    nextUpsertError = new Error("DB unavailable");

    const { deployMonitorsForVendor } = await import("@/lib/server/monitors");
    const result = await deployMonitorsForVendor("acct-1", "pk-test", vendor());

    // First remote monitor created → DB failed → cancelled.
    expect(createMonitor.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(cancelMonitor).toHaveBeenCalledWith("mon-1");
    // The first monitor must NOT appear in the returned `created` array
    // (it wasn't persisted, so the dashboard never knows about it).
    const ids = result.map((m) => m.monitorId);
    expect(ids).not.toContain("mon-1");
  });

  it("writes an audit row when both DB upsert AND remote cancel fail", async () => {
    createMonitor.mockResolvedValueOnce({ monitor_id: "mon-X" });
    cancelMonitor.mockRejectedValueOnce(new Error("Parallel 500"));
    nextUpsertError = new Error("DB unavailable");

    const { deployMonitorsForVendor } = await import("@/lib/server/monitors");
    await deployMonitorsForVendor("acct-1", "pk-test", vendor());

    const orphan = writes.find(
      (w) => w.table === "audit_log" && (w.payload as { action?: string }).action === "monitors.deploy_orphan",
    );
    expect(orphan).toBeDefined();
    expect((orphan!.payload.metadata as Record<string, unknown>).parallel_monitor_id).toBe("mon-X");
  });

  it("persists + returns DeployedMonitor when DB upsert succeeds", async () => {
    let count = 0;
    createMonitor.mockImplementation(async () => ({ monitor_id: `mon-${++count}` }));

    const { deployMonitorsForVendor } = await import("@/lib/server/monitors");
    const result = await deployMonitorsForVendor("acct-1", "pk-test", vendor());

    expect(cancelMonitor).not.toHaveBeenCalled();
    expect(result.length).toBeGreaterThan(0);
    // Every returned monitor must have a corresponding monitors upsert.
    for (const dep of result) {
      const match = writes.find(
        (w) =>
          w.table === "monitors" &&
          w.op === "upsert" &&
          (w.payload as { parallel_monitor_id?: string }).parallel_monitor_id === dep.monitorId,
      );
      expect(match).toBeDefined();
    }
  });
});
