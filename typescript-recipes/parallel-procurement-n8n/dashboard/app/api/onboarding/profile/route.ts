import { NextResponse } from "next/server";
import { HttpError, requireAccount } from "@/lib/server/account";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const account = await requireAccount();
    const body = await request.json();
    const display_name = String(body?.displayName ?? "").trim() || null;
    const email = String(body?.email ?? "").trim() || null;
    const { error } = await db()
      .from("accounts")
      .update({ display_name, email })
      .eq("id", account.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/onboarding/profile]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 400 },
    );
  }
}
