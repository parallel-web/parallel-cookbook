import { NextResponse } from "next/server";
import { HttpError, requireAccountWithKey } from "@/lib/server/account";
import { deleteMonitor } from "@/lib/server/monitors";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ monitorId: string }> },
) {
  try {
    const { monitorId } = await context.params;
    const account = await requireAccountWithKey();
    await deleteMonitor(account.id, account.parallelApiKey, monitorId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/monitors/[id]] error", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
