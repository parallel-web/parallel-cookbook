import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { byteaToBytes, decryptApiKey } from "@/lib/server/crypto";
import { HttpError, requireAccount } from "@/lib/server/account";
import { recordTestResult } from "@/lib/server/integrations";
import {
  testParallelKey,
  testResendKey,
  testSlackToken,
  postSlackMessage,
  sendResendEmail,
} from "@/lib/server/providers";
import type { IntegrationProvider } from "@/lib/server/integrations";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ integrationId: string }> },
) {
  try {
    const account = await requireAccount();
    const { integrationId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      mode?: "validate" | "send";
    };
    const mode = body.mode === "send" ? "send" : "validate";

    const { data, error } = await db()
      .from("integrations")
      .select("id, provider, encrypted_secret, metadata")
      .eq("id", integrationId)
      .eq("account_id", account.id)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    const provider = data.provider as IntegrationProvider;
    const secret = await decryptApiKey(byteaToBytes(data.encrypted_secret));
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;

    let result;
    if (mode === "send") {
      result = await sendTestPayload(provider, secret, metadata, account.email);
    } else {
      result = await validate(provider, secret);
    }

    await recordTestResult(account.id, integrationId, result.ok, result.error ?? null);

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/integrations/:id/test]", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function validate(provider: IntegrationProvider, secret: string) {
  switch (provider) {
    case "parallel":
      return await testParallelKey(secret);
    case "slack":
      return await testSlackToken(secret);
    case "email":
      return await testResendKey(secret);
  }
}

async function sendTestPayload(
  provider: IntegrationProvider,
  secret: string,
  metadata: Record<string, unknown>,
  recipientEmail: string | null,
) {
  switch (provider) {
    case "parallel":
      return await testParallelKey(secret);
    case "slack": {
      const channel = (metadata.channel as string | undefined) ?? "#general";
      return await postSlackMessage({
        token: secret,
        channel,
        text: ":test_tube: Test message from Parallel Procurement — your Slack integration is working.",
      });
    }
    case "email": {
      if (!recipientEmail) {
        return { ok: false, error: "No email on this account to send a test to." };
      }
      const from =
        (metadata.from as string | undefined) ??
        "Procurement Risk <onboarding@resend.dev>";
      return await sendResendEmail({
        apiKey: secret,
        from,
        to: recipientEmail,
        subject: "Parallel Procurement test email",
        html: "<p>Your Resend integration is connected. You'll receive HIGH and CRITICAL alerts at this address.</p>",
      });
    }
  }
}
