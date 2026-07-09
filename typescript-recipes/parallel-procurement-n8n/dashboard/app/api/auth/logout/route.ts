import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/server/session";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  await clearSessionCookie();
  return NextResponse.redirect(`${env().APP_URL}/signin`, { status: 302 });
}
