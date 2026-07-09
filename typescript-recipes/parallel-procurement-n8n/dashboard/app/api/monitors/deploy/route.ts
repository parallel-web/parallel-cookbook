import { NextResponse } from "next/server";
import { HttpError, requireAccountWithKey } from "@/lib/server/account";
import { db } from "@/lib/server/db";
import { deployMonitorsForVendor } from "@/lib/server/monitors";
import type { VendorRow } from "@/lib/server/vendors";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const account = await requireAccountWithKey();
    const body = await request.json().catch(() => ({}));
    const requested: string[] = Array.isArray(body?.vendorIds)
      ? body.vendorIds
      : body?.vendorId
        ? [body.vendorId]
        : [];

    let query = db().from("vendors").select("*").eq("account_id", account.id);
    if (requested.length > 0) {
      query = query.in("id", requested);
    }
    const { data: vendors, error } = await query;
    if (error) throw error;
    if (!vendors?.length) {
      return NextResponse.json({ error: "No vendors to deploy" }, { status: 400 });
    }

    const results = [];
    for (const vendor of vendors as VendorRow[]) {
      const created = await deployMonitorsForVendor(
        account.id,
        account.parallelApiKey,
        vendor,
      );
      results.push({ vendorId: vendor.id, count: created.length, monitors: created });
    }
    return NextResponse.json({ results }, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/monitors/deploy] error", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
