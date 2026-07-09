import { NextResponse } from "next/server";
import { HttpError, requireAccount } from "@/lib/server/account";
import {
  addIntegration,
  listIntegrations,
  type IntegrationProvider,
} from "@/lib/server/integrations";
import { testProviderKey } from "@/lib/server/providers";

export const runtime = "nodejs";

const PROVIDERS: ReadonlySet<IntegrationProvider> = new Set([
  "parallel",
  "slack",
  "email",
]);

export async function GET() {
  try {
    const account = await requireAccount();
    const integrations = await listIntegrations(account.id);
    return NextResponse.json({ integrations });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const account = await requireAccount();
    const body = (await request.json().catch(() => ({}))) as {
      provider?: string;
      secret?: string;
      label?: string;
      metadata?: Record<string, unknown>;
      validate?: boolean;
    };

    const provider = body.provider as IntegrationProvider;
    const secret = (body.secret ?? "").trim();

    if (!provider || !PROVIDERS.has(provider)) {
      return NextResponse.json(
        { error: "Provider must be one of: parallel, slack, email" },
        { status: 400 },
      );
    }
    if (!secret) {
      return NextResponse.json({ error: "Secret is required" }, { status: 400 });
    }

    if (body.validate !== false) {
      const test = await testProviderKey(provider, secret);
      if (!test.ok) {
        return NextResponse.json(
          { error: test.error ?? "Validation failed" },
          { status: 422 },
        );
      }
    }

    const integration = await addIntegration({
      accountId: account.id,
      provider,
      secret,
      label: body.label,
      metadata: body.metadata,
      makeDefault: true,
    });

    return NextResponse.json({ integration }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[api/integrations]", err);
  const message = err instanceof Error ? err.message : "Internal error";
  return NextResponse.json({ error: message }, { status: 500 });
}
