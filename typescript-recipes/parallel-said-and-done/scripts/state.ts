/**
 * Copies pipeline state between this folder (data/ and output/) and the
 * deployment's private Blob store. Needs BLOB_READ_WRITE_TOKEN.
 *
 *   pnpm state migrate     local only: output/monitors.json → one record per company
 *   pnpm state push        this folder → Blob (seeds a new deployment)
 *   pnpm state pull        Blob → this folder (to inspect or rebuild what the deployment did)
 *   pnpm state push --dry  list what would be copied
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { eachLimit } from "../src/pipeline/reconcile";
import { APP_ROOT, blobStorage, fileStorage, type Storage } from "../src/storage";
import type { MonitorRecord } from "../src/store";
import { flag, loadEnv, positional } from "./lib/env";

loadEnv();
const [command] = positional();

// Pipeline state only: not logs, scratch exports or locks.
const SKIP = [/^output\/(logs|video|compare|factcheck|locks)\//, /\.tgz$/, /^output\/(monitors|pending-sheets)\.json$/, /\.tmp$/];
const wanted = (path: string) => (path.startsWith("data/") || path.startsWith("output/")) && !SKIP.some((re) => re.test(path));

async function migrate() {
  const legacy = join(APP_ROOT, "output/monitors.json");
  if (!existsSync(legacy)) return console.log("no output/monitors.json to migrate");
  const files = fileStorage();
  const records = JSON.parse(readFileSync(legacy, "utf8")) as MonitorRecord[];
  for (const r of records) await files.put(`output/monitors/${r.ticker}.json`, `${JSON.stringify({ ...r, webhookUrl: r.webhookUrl ?? null }, null, 2)}\n`);
  rmSync(legacy);
  console.log(`${records.length} monitor records → output/monitors/`);
}

async function copy(from: Storage, to: Storage) {
  const paths = [...(await from.list("data/")), ...(await from.list("output/"))].filter(wanted);
  console.log(`${from.name} → ${to.name}: ${paths.length} files`);
  if (flag("dry") === "true") return paths.slice(0, 20).forEach((p) => console.log(`  ${p}`));
  let done = 0;
  await eachLimit(paths, 16, async (p) => {
    const body = await from.get(p);
    if (body !== null) await to.put(p, body);
    done += 1;
    if (done % 250 === 0) console.log(`  ${done}/${paths.length}`);
  });
  console.log(`  ${done}/${paths.length} copied`);
}

if (command === "migrate") await migrate();
else if (command === "push" || command === "pull") {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is not set");
    process.exit(1);
  }
  const files = fileStorage();
  const blob = blobStorage();
  await (command === "push" ? copy(files, blob) : copy(blob, files));
} else console.log("usage: pnpm state migrate|push|pull [--dry]");
