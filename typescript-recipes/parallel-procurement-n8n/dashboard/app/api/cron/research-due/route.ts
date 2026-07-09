import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/server/db";
import { getActiveIntegration } from "@/lib/server/integrations";
import { runResearchForVendors } from "@/lib/server/research";
import { isCronAuthorized } from "@/lib/server/cron-auth";
import type { VendorRow } from "@/lib/server/vendors";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily 06:00 UTC sweep:
 *  - For every vendor whose next_research_date <= today, queue a fresh
 *    research run, batched per-account so each account uses its own API key.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Treat null next_research_date as "never researched → due now" — matches
  // BatchPlanner.getVendorsDueForResearch. Postgres `lte` ignores nulls,
  // so we explicitly OR them in.
  const { data: dueVendors, error } = await db()
    .from("vendors")
    .select("*")
    .or(`next_research_date.is.null,next_research_date.lte.${today}`);
  if (error) throw error;
  if (!dueVendors?.length) return NextResponse.json({ ok: true, scheduled: 0 });

  const byAccount = new Map<string, VendorRow[]>();
  for (const v of dueVendors as VendorRow[]) {
    const arr = byAccount.get(v.account_id) ?? [];
    arr.push(v);
    byAccount.set(v.account_id, arr);
  }

  let totalScheduled = 0;
  for (const [accountId, vendors] of byAccount) {
    const { data: account } = await db()
      .from("accounts")
      .select("onboarded_at")
      .eq("id", accountId)
      .maybeSingle();
    if (!account?.onboarded_at) continue;

    const integration = await getActiveIntegration(accountId, "parallel");
    if (!integration) continue;

    try {
      const result = await runResearchForVendors(accountId, integration.secret, vendors);
      totalScheduled += result.total;
    } catch (err) {
      console.error("[cron/research-due] failed for account", accountId, err);
    }
  }

  return NextResponse.json({ ok: true, scheduled: totalScheduled });
}
