/**
 * GICS sector and industry for every company in config/companies.json that has
 * no profile on the current spec (one base Task run each, about $0.01).
 *
 *   pnpm profiles
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { drive } from "../src/pipeline/drive";
import { startProfile } from "../src/sheet/profile";
import { readCoverageConfig, withLock } from "../src/store";
import { loadEnv } from "./lib/env";

loadEnv();
const log = (line: string) => console.log(line);
try {
  const client = parallelClient();
  const { companies } = readCoverageConfig();
  for (const c of companies) await withLock(c.ticker, () => startProfile(client, c));
  await drive(client, companies.map((c) => c.ticker), log);
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
