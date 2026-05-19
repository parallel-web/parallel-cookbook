import { NextResponse } from "next/server";
import { HttpError, requireAccountWithKey } from "@/lib/server/account";
import { db } from "@/lib/server/db";
import { runResearchForVendors } from "@/lib/server/research";
import type { VendorRow } from "@/lib/server/vendors";

export const runtime = "nodejs";
// Research kickoff occasionally takes >10s if Parallel is slow.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const account = await requireAccountWithKey();
    const body = await request.json().catch(() => ({}));
    const requested: string[] = Array.isArray(body?.vendorIds) ? body.vendorIds : [];

    let query = db().from("vendors").select("*").eq("account_id", account.id);
    if (requested.length > 0) {
      query = query.in("id", requested);
    }
    const { data: vendors, error } = await query;
    if (error) throw error;
    if (!vendors?.length) {
      return NextResponse.json(
        { error: "No vendors found to research" },
        { status: 400 },
      );
    }

    const result = await runResearchForVendors(
      account.id,
      account.parallelApiKey,
      vendors as VendorRow[],
    );
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/research/run] error", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
