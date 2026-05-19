import "server-only";
import type { NextRequest } from "next/server";

/**
 * Public callers can spoof Vercel's `x-vercel-cron` header, so the cron routes
 * require a shared bearer secret for every environment. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET` automatically when that env var exists.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader === `Bearer ${secret}`) return true;
  return false;
}
