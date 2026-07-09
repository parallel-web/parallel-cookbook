import { NextResponse } from "next/server";
import { HttpError, requireAccount } from "@/lib/server/account";
import {
  deleteIntegration,
  rotateIntegration,
  updateIntegrationMetadata,
  type IntegrationProvider,
} from "@/lib/server/integrations";
import { db } from "@/lib/server/db";
import { testProviderKey } from "@/lib/server/providers";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ integrationId: string }> },
) {
  try {
    const account = await requireAccount();
    const { integrationId } = await context.params;
    await deleteIntegration(account.id, integrationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ integrationId: string }> },
) {
  try {
    const account = await requireAccount();
    const { integrationId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      secret?: string;
      metadata?: Record<string, unknown>;
      validate?: boolean;
    };

    if (typeof body.secret === "string" && body.secret.trim().length > 0) {
      const secret = body.secret.trim();
      // Look up the provider so we can validate the new secret BEFORE
      // persisting. Mirrors POST behavior — a bogus rotated key fails fast
      // with 422 instead of silently breaking the next cron/webhook tick.
      const { data: row } = await db()
        .from("integrations")
        .select("provider")
        .eq("id", integrationId)
        .eq("account_id", account.id)
        .maybeSingle();
      if (!row) {
        return NextResponse.json({ error: "Integration not found" }, { status: 404 });
      }

      // `validate=false` lets the caller opt out (e.g. if they're rotating
      // to a key the test endpoint can't reach), matching POST semantics.
      if (body.validate !== false) {
        const test = await testProviderKey(row.provider as IntegrationProvider, secret);
        if (!test.ok) {
          return NextResponse.json(
            { error: test.error ?? "Validation failed" },
            { status: 422 },
          );
        }
      }

      const updated = await rotateIntegration({
        accountId: account.id,
        integrationId,
        secret,
      });
      return NextResponse.json({ integration: updated });
    }

    if (body.metadata && typeof body.metadata === "object") {
      const updated = await updateIntegrationMetadata(
        account.id,
        integrationId,
        body.metadata,
      );
      return NextResponse.json({ integration: updated });
    }

    return NextResponse.json(
      { error: "Provide either `secret` (to rotate) or `metadata` (to update)" },
      { status: 400 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[api/integrations/:id]", err);
  const message = err instanceof Error ? err.message : "Internal error";
  return NextResponse.json({ error: message }, { status: 500 });
}
