import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/server/db";
import { getActiveIntegration } from "@/lib/server/integrations";
import { refreshTaskGroupStatus } from "@/lib/server/research";
import { isCronAuthorized } from "@/lib/server/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Hourly sweep:
 *  - For every task_groups row in `running` state, ask Parallel for the
 *    latest counts, persist them, and reconcile any runs that completed
 *    without delivering a webhook.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: groups } = await db()
    .from("task_groups")
    .select("account_id, task_group_id")
    .eq("status", "running");

  if (!groups?.length) return NextResponse.json({ ok: true, swept: 0 });

  const swept: string[] = [];
  for (const g of groups) {
    const integration = await getActiveIntegration(g.account_id, "parallel");
    if (!integration) continue;
    try {
      await refreshTaskGroupStatus(g.account_id, integration.secret, g.task_group_id);
      swept.push(g.task_group_id);
    } catch (err) {
      console.error("[cron/sweep] failed for", g.task_group_id, err);
    }
  }

  return NextResponse.json({ ok: true, swept: swept.length });
}
