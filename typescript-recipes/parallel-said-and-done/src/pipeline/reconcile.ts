/**
 * The safety net under the webhooks, run hourly by Vercel Cron
 * (src/app/api/cron/reconcile) or by hand with `pnpm monitors poll`:
 *
 *   1. runs whose webhook never arrived: fetch their status, handle the finished ones
 *   2. monitor events no webhook delivered
 *   3. calls still waiting for a transcript, and calls no monitor reported
 *   4. live sheets: profiles, quality steps and a monitor
 *   5. monitor queries and webhooks
 *
 * Everything is driven by stored state, so running it twice does nothing new.
 */
import type { Parallel } from "../parallel/client";
import { publicError } from "../parallel/client";
import { PROFILE_SPEC_KEY, startProfile } from "../sheet/profile";
import { readManifest } from "../sheet/stored";
import { companyFor, readInflight, readMonitors, readProfiles, withLock } from "../store";
import { coveredTickers, ensureMonitor, handleMonitorEvents, notFound, recentEvents, replaceMissing, syncMonitors } from "../updates/monitors";
import { catchUpCalls, retryWaiting } from "../updates/update";
import { advance, onRunComplete } from "./advance";

type Log = (line: string) => void;

/** Runs `fn` over items, a few at a time. */
export async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: limit }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

export async function reconcile(client: Parallel, options: { tickers?: string[]; staleMinutes?: number; log: Log }) {
  const { log } = options;
  const tickers = options.tickers ?? coveredTickers();
  const stale = (options.staleMinutes ?? 20) * 60_000;
  const safely = (label: string) => async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (error) {
      log(`${label}: ${publicError(error)}`);
    }
  };

  // 1. Runs in flight longer than a webhook should take.
  await eachLimit(tickers, 8, async (t) => {
    for (const [runId, entry] of Object.entries(await readInflight(t))) {
      if (Date.now() - new Date(entry.startedAt).getTime() < stale) continue;
      await safely(`${t} ${runId}`)(async () => {
        const outcome = await onRunComplete(client, runId, log);
        if (outcome === "handled") log(`${t}: picked up ${runId} without a webhook`);
      });
    }
  });

  // 2. Monitor events no webhook delivered. A monitor this key cannot find is replaced.
  const monitors = (await readMonitors()).filter((r) => tickers.includes(r.ticker) && !r.cancelledAt);
  await eachLimit(monitors, 8, async (r) => {
    await safely(`${r.ticker} monitor`)(async () => {
      let events;
      try {
        events = await recentEvents(client, r.monitorId);
      } catch (error) {
        if (!notFound(error)) throw error;
        await withLock(r.ticker, () => replaceMissing(client, r, log));
        return;
      }
      const handled = await handleMonitorEvents(client, r.ticker, events, log);
      if (handled) log(`${r.ticker}: ${handled} monitor events picked up without a webhook`);
    });
  });

  // 3. Calls waiting for a transcript, and scheduled calls no monitor reported as held.
  await safely("retry waiting")(() => retryWaiting(client, { log, tickers }));
  await safely("catch up calls")(() => catchUpCalls(client, { log, tickers }));

  // Only a register explicitly built with this store can start recurring work.
  const profiles = await readProfiles();
  await eachLimit(tickers, 4, async (t) => {
    await safely(`${t} advance`)(async () => {
      if (!(await readManifest(t))) return;
      await withLock(t, async () => {
        const inflight = Object.values(await readInflight(t));
        if (profiles[t]?.spec !== PROFILE_SPEC_KEY && !inflight.some((r) => r.kind === "profile-run")) await startProfile(client, companyFor(t));
        await advance(client, t, log);
        await ensureMonitor(client, t, log);
      });
    });
  });

  // 5. Monitor queries and webhooks.
  await safely("sync monitors")(() => syncMonitors(client, { replace: false, tickers, log }));
}
