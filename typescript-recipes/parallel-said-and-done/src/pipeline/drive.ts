/**
 * Running the pipeline locally, without a public URL for webhooks: waits on
 * every run in flight for these companies and hands each result to
 * `onRunComplete`, exactly as the webhook route would, until none are left.
 */
import type { Parallel } from "../parallel/client";
import { awaitResult } from "../parallel/task";
import { readInflight } from "../store";
import { onRunComplete } from "./advance";

export async function drive(client: Parallel, tickers: string[], log: (line: string) => void) {
  const seen = new Set<string>();
  for (;;) {
    const pending = (await Promise.all(tickers.map(async (t) => Object.keys(await readInflight(t)).map((id) => [t, id] as const)))).flat();
    const fresh = pending.filter(([, id]) => !seen.has(id));
    if (!fresh.length) return;
    log(`waiting on ${fresh.length} runs: ${fresh.map(([t]) => t).join(" ")}`);
    await Promise.all(
      fresh.map(async ([t, id]) => {
        seen.add(id);
        try {
          // A failed run has no result; onRunComplete records the failure.
          await awaitResult(client, id, undefined, 150).catch(() => null);
          await onRunComplete(client, id, log);
        } catch (error) {
          log(`${t} ${id}: ${(error as Error).message}`);
        }
      }),
    );
  }
}
