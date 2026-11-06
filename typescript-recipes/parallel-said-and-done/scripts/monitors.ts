/**
 * One event_stream monitor per company watches for new earnings calls.
 *
 *   pnpm monitors create [TICKER…]
 *   pnpm monitors list
 *   pnpm monitors poll             the live loop: new events → call day → update run → gate → publish
 *   pnpm monitors sync             replace monitors on an older spec; refresh queries after the registers change
 *   pnpm monitors trigger MSFT     run a monitor now (bills one execution)
 *   pnpm monitors cancel [TICKER…] --yes
 *
 * Monitor IDs are kept in output/monitors.json (gitignored). Monitors bill per
 * execution until cancelled: 8 × lite × every 6 h ≈ $2.90 a month.
 */
import { parallelClient, publicError } from "../src/parallel/client";
import {
  cancelMonitors,
  coveredTickers,
  createMonitors,
  listMonitors,
  pollMonitors,
  syncMonitors,
  triggerMonitors,
} from "../src/updates/monitors";
import { flag, loadEnv, positional } from "./lib/env";

loadEnv();
const [command, ...rest] = positional();
const client = parallelClient();
const log = (line: string) => console.log(line);
const tickers = (rest.length ? rest : coveredTickers()).map((t) => t.toUpperCase());

try {
  if (command === "create") {
    await createMonitors(client, tickers, null, log);
  } else if (command === "list") await listMonitors(client, log);
  else if (command === "poll") await pollMonitors(client, { tickers: rest.length ? tickers : undefined, log });
  else if (command === "sync") await syncMonitors(client, { replace: true, log });
  else if (command === "trigger") await triggerMonitors(client, tickers, log);
  else if (command === "cancel") {
    if (flag("yes") !== "true") log("Cancelling is irreversible; add --yes to confirm.");
    else await cancelMonitors(client, tickers, log);
  } else log("usage: pnpm monitors create|list|poll|sync|trigger|cancel [TICKER…]");
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
