/**
 * One event_stream monitor per company watches for new earnings calls and
 * announcements. On the deployment each reports to the webhook; locally,
 * `poll` reads their events instead.
 *
 *   pnpm monitors create [TICKER…]
 *   pnpm monitors list
 *   pnpm monitors poll [TICKER…]   the reconcile, then waits on any runs it starts
 *   pnpm monitors sync             queries in step with the sheets, webhook = WEBHOOK_URL; replaces monitors on an older spec
 *   pnpm monitors trigger MSFT     run a monitor now (bills one execution)
 *   pnpm monitors cancel [TICKER…] --yes
 *
 * Monitors bill per execution until cancelled: lite every 6 h is about $0.36 a company a month.
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { drive } from "../src/pipeline/drive";
import { reconcile } from "../src/pipeline/reconcile";
import { cancelMonitors, coveredTickers, createMonitors, listMonitors, syncMonitors, triggerMonitors } from "../src/updates/monitors";
import { flag, loadEnv, positional } from "./lib/env";

loadEnv();
const [command, ...rest] = positional();
const log = (line: string) => console.log(line);
const tickers = (rest.length ? rest : coveredTickers()).map((t) => t.toUpperCase());

try {
  const client = parallelClient();
  if (command === "create") await createMonitors(client, tickers, log);
  else if (command === "list") await listMonitors(client, log);
  else if (command === "poll") {
    await reconcile(client, { tickers, staleMinutes: 0, log });
    await drive(client, tickers, log);
  } else if (command === "sync") await syncMonitors(client, { replace: true, tickers, log });
  else if (command === "trigger") await triggerMonitors(client, tickers, log);
  else if (command === "cancel") {
    if (flag("yes") !== "true") log("Cancelling is irreversible; add --yes to confirm.");
    else await cancelMonitors(client, tickers, log);
  } else log("usage: pnpm monitors create|list|poll|sync|trigger|cancel [TICKER…]");
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
