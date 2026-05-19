import { NextResponse } from "next/server";
import { requireAccount, HttpError } from "@/lib/server/account";
import { insertVendor, listVendorsByAccount } from "@/lib/server/vendors";

export const runtime = "nodejs";

export async function GET() {
  try {
    const account = await requireAccount();
    const vendors = await listVendorsByAccount(account.id);
    return NextResponse.json({ vendors });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const account = await requireAccount();
    const body = await request.json();
    const vendor = await insertVendor(account.id, body);
    return NextResponse.json({ vendor }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[api/vendors] error", err);
  const message = err instanceof Error ? err.message : "Internal error";
  return NextResponse.json({ error: message }, { status: 400 });
}
