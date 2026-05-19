import { NextResponse } from "next/server";
import { HttpError, requireAccount } from "@/lib/server/account";
import { deleteVendor, updateVendor } from "@/lib/server/vendors";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ vendorId: string }> },
) {
  try {
    const { vendorId } = await context.params;
    const account = await requireAccount();
    const body = await request.json();
    const vendor = await updateVendor(account.id, vendorId, body);
    return NextResponse.json({ vendor });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ vendorId: string }> },
) {
  try {
    const { vendorId } = await context.params;
    const account = await requireAccount();
    await deleteVendor(account.id, vendorId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[api/vendors/[id]] error", err);
  const message = err instanceof Error ? err.message : "Internal error";
  return NextResponse.json({ error: message }, { status: 400 });
}
