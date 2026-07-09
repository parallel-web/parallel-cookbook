import { NextResponse } from "next/server";
import { HttpError, requireAccount } from "@/lib/server/account";
import { insertVendor, parseVendorList } from "@/lib/server/vendors";

export const runtime = "nodejs";

/**
 * POST a JSON body { text: "csv or paste-list contents" } OR
 * an array { vendors: [VendorInput, ...] } and we will upsert each.
 */
export async function POST(request: Request) {
  try {
    const account = await requireAccount();
    const body = await request.json();
    const inputs = Array.isArray(body?.vendors)
      ? body.vendors
      : parseVendorList(String(body?.text ?? ""));
    if (!inputs.length) {
      return NextResponse.json(
        { error: "No vendors found in input" },
        { status: 400 },
      );
    }
    const inserted = [];
    const errors: Array<{ vendorName: string; error: string }> = [];
    for (const input of inputs) {
      try {
        const row = await insertVendor(account.id, input);
        inserted.push(row);
      } catch (err) {
        errors.push({
          vendorName: String(input?.vendorName ?? "(unknown)"),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return NextResponse.json({ inserted, errors });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/vendors/import] error", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
