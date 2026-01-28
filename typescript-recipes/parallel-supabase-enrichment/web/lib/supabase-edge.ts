/**
 * Helper for calling Supabase Edge Functions from Next.js API routes.
 *
 * This module centralizes the configuration and error handling for
 * server-to-server calls to Supabase Edge Functions.
 */
import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

type EdgeFunctionOptions = {
  functionName: string;
  body?: unknown;
};

/**
 * Call a Supabase Edge Function with proper authentication.
 *
 * Returns the response data and status, or an error response if configuration
 * is missing or the request fails.
 */
export async function callEdgeFunction({
  functionName,
  body,
}: EdgeFunctionOptions): Promise<NextResponse> {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Missing Supabase configuration" },
      { status: 500 }
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
