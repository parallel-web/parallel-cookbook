import { NextResponse } from "next/server";
import { HttpError, requireAccountWithKey } from "@/lib/server/account";
import { db } from "@/lib/server/db";
import { deployMonitorsForVendor } from "@/lib/server/monitors";
import type { VendorRow } from "@/lib/server/vendors";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Final step of onboarding: deploy the per-priority monitor portfolio for
 * every vendor, then mark the account onboarded so the middleware stops
 * forcing the user back to /onboarding/*.
 */
export async function POST() {
  try {
    const account = await requireAccountWithKey();

    const { data: vendors, error } = await db()
      .from("vendors")
      .select("*")
      .eq("account_id", account.id);
    if (error) throw error;

    const summary = {
      monitorsCreated: 0,
      vendorsCovered: 0,
    };

    for (const vendor of (vendors ?? []) as VendorRow[]) {
      try {
        const created = await deployMonitorsForVendor(
          account.id,
          account.parallelApiKey,
          vendor,
        );
        summary.monitorsCreated += created.length;
        if (created.length > 0) summary.vendorsCovered += 1;
      } catch (err) {
        console.error(
          "[onboarding/complete] failed to deploy monitors for",
          vendor.vendor_name,
          err,
        );
      }
    }

    await db()
      .from("accounts")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", account.id);

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/onboarding/complete]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
