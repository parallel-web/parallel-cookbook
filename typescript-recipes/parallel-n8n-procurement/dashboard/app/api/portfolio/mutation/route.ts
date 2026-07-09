import { NextResponse } from "next/server";
import {
  DASHBOARD_MUTATION_URL_ENV,
  DASHBOARD_WRITE_TOKEN_ENV,
  DASHBOARD_WRITE_TOKEN_HEADER,
  isPortfolioMutationRequest,
  type PortfolioMutationResponse,
} from "@/lib/portfolio-mutations";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const mutationUrl = process.env[DASHBOARD_MUTATION_URL_ENV]?.trim();
  const writeToken = process.env[DASHBOARD_WRITE_TOKEN_ENV]?.trim();

  if (!mutationUrl || !writeToken) {
    return NextResponse.json<PortfolioMutationResponse>(
      {
        ok: false,
        error: `Set ${DASHBOARD_MUTATION_URL_ENV} and ${DASHBOARD_WRITE_TOKEN_ENV} before using portfolio write-back.`,
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<PortfolioMutationResponse>({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  if (!isPortfolioMutationRequest(body)) {
    return NextResponse.json<PortfolioMutationResponse>({ ok: false, error: "Invalid portfolio mutation payload." }, { status: 400 });
  }

  try {
    const response = await fetch(mutationUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        [DASHBOARD_WRITE_TOKEN_HEADER]: writeToken,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const responseBody = (await response.json().catch(() => ({
      ok: response.ok,
      error: response.ok ? undefined : `n8n mutation webhook returned HTTP ${response.status}.`,
    }))) as PortfolioMutationResponse;

    return NextResponse.json<PortfolioMutationResponse>(responseBody, { status: response.ok ? response.status : 200 });
  } catch (error) {
    return NextResponse.json<PortfolioMutationResponse>(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to reach the n8n mutation webhook.",
      },
    );
  }
}
