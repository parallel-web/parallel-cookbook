/**
 * Optional scheduled recovery for missed webhooks. See src/pipeline/reconcile.ts.
 */
import { parallelClient, publicError } from "../../../../parallel/client";
import { reconcile } from "../../../../pipeline/reconcile";
import { storage } from "../../../../storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // A read-only deployment (no key, or no Blob store to write to) has nothing to reconcile.
  if (!process.env.PARALLEL_API_KEY || storage().name !== "blob") return Response.json({ ok: true, skipped: "not configured" });
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

  // One reconcile at a time, and not more often than every ten minutes.
  const marker = "output/locks/reconcile-last.json";
  const last = await storage().get(marker);
  if (last && Date.now() - new Date(JSON.parse(last).at).getTime() < 10 * 60_000) return Response.json({ ok: true, skipped: "ran recently" });
  await storage().put(marker, JSON.stringify({ at: new Date().toISOString() }));

  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    console.log(line);
  };
  try {
    await reconcile(parallelClient(), { log });
    return Response.json({ ok: true, log: lines });
  } catch (error) {
    return Response.json({ ok: false, error: publicError(error), log: lines }, { status: 500 });
  }
}
