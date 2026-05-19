import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/server/db";
import { sha256Hex } from "@/lib/server/crypto";
import { setSessionCookie } from "@/lib/server/session";
import { addIntegration } from "@/lib/server/integrations";
import { testParallelKey } from "@/lib/server/providers";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let payload: { email?: string; apiKey?: string };
  try {
    payload = (await request.json()) as { email?: string; apiKey?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const email = (payload.email ?? "").trim().toLowerCase();
  const apiKey = (payload.apiKey ?? "").trim();

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address" }, { status: 400 });
  }
  if (!apiKey || apiKey.length < 12) {
    return NextResponse.json({ ok: false, error: "API key looks too short" }, { status: 400 });
  }

  // Validate against Parallel before we persist anything. This proves the
  // presented key is usable, but it is not identity proof for an existing
  // account; that check happens below by matching the stored secret hash.
  const test = await testParallelKey(apiKey);
  if (!test.ok) {
    return NextResponse.json(
      { ok: false, error: test.error ?? "Parallel rejected this key" },
      { status: 401 },
    );
  }

  const emailHash = await sha256Hex(email);

  // Upsert account by email_hash.
  const { data: existing, error: lookupErr } = await db()
    .from("accounts")
    .select("id, onboarded_at")
    .eq("email_hash", emailHash)
    .maybeSingle();

  if (lookupErr) {
    console.error("[auth/key] lookup failed", lookupErr);
    return NextResponse.json(
      { ok: false, error: "Account lookup failed" },
      { status: 500 },
    );
  }

  let accountId: string;
  let onboarded = false;

  if (existing) {
    accountId = existing.id;
    onboarded = !!existing.onboarded_at;

    const apiKeyHash = await sha256Hex(apiKey);
    const { data: matchingIntegration, error: integrationLookupErr } = await db()
      .from("integrations")
      .select("id")
      .eq("account_id", accountId)
      .eq("provider", "parallel")
      .eq("secret_hash", apiKeyHash)
      .eq("status", "active")
      .maybeSingle();

    if (integrationLookupErr) {
      console.error("[auth/key] integration lookup failed", integrationLookupErr);
      return NextResponse.json(
        { ok: false, error: "Account lookup failed" },
        { status: 500 },
      );
    }

    if (!matchingIntegration) {
      return NextResponse.json(
        { ok: false, error: "Email or Parallel API key is incorrect" },
        { status: 401 },
      );
    }

    await db().from("accounts").update({ email }).eq("id", accountId);
  } else {
    const { data: created, error: createErr } = await db()
      .from("accounts")
      .insert({ email, email_hash: emailHash })
      .select("id")
      .single();
    if (createErr || !created) {
      console.error("[auth/key] create failed", createErr);
      return NextResponse.json(
        { ok: false, error: "Could not create account" },
        { status: 500 },
      );
    }
    accountId = created.id;
    try {
      await addIntegration({
        accountId,
        provider: "parallel",
        secret: apiKey,
        label: "default",
        makeDefault: true,
        actor: "system",
      });
    } catch (err) {
      console.error("[auth/key] failed to store parallel integration", err);
      return NextResponse.json(
        { ok: false, error: "Could not store API key" },
        { status: 500 },
      );
    }
  }

  await setSessionCookie({ accountId });

  return NextResponse.json({
    ok: true,
    next: onboarded ? "/" : "/onboarding/profile",
  });
}
