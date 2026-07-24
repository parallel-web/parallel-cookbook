/**
 * Backfills the missing `basis` (citations + reasoning) on facility enrichment
 * blob files that were imported with data but no basis.
 *
 * Each blob file (enrichments/{index}.json) already stores the `runId` of the
 * Task API enrichment run that produced it. Those runs are still retrievable,
 * so we re-fetch /result and write output.basis back onto the file — no new
 * Task API runs, no fabricated data.
 *
 * Usage: npx tsx scripts/backfill-basis.ts [--dry]
 */

import { list, put } from "@vercel/blob";
import * as fs from "fs";

const BASE_URL = "https://api.parallel.ai";

function env(key: string): string {
  const line = fs.readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(key + "="));
  return line ? line.slice(key.length + 1).replace(/^["']|["']$/g, "").trim() : "";
}

const API_KEY = process.env.PARALLEL_API_KEY || env("PARALLEL_API_KEY");
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || env("BLOB_READ_WRITE_TOKEN");
const DRY = process.argv.includes("--dry");

interface BlobEntry {
  enrichment?: Record<string, unknown>;
  basis?: unknown[];
  runId?: string;
  [k: string]: unknown;
}

async function fetchResultBasis(runId: string): Promise<unknown[] | null> {
  try {
    const statusRes = await fetch(`${BASE_URL}/v1/tasks/runs/${runId}`, { headers: { "x-api-key": API_KEY } });
    if (!statusRes.ok) return null;
    const status = await statusRes.json();
    if (status.status !== "completed") return null;
    const res = await fetch(`${BASE_URL}/v1/tasks/runs/${runId}/result`, { headers: { "x-api-key": API_KEY } });
    if (!res.ok) return null;
    const data = await res.json();
    const basis = data.output?.basis;
    return Array.isArray(basis) ? basis : null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  if (!API_KEY || !TOKEN) { console.error("Missing PARALLEL_API_KEY or BLOB_READ_WRITE_TOKEN"); process.exit(1); }

  // 1. List every enrichment blob and its downloadUrl
  console.log("Listing enrichment blobs…");
  const files: { index: number; pathname: string; downloadUrl: string }[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix: "enrichments/", token: TOKEN, cursor, limit: 1000 });
    for (const b of r.blobs) {
      const m = b.pathname.match(/enrichments\/(\d+)\.json$/);
      if (m) files.push({ index: Number(m[1]), pathname: b.pathname, downloadUrl: b.downloadUrl });
    }
    cursor = r.cursor;
  } while (cursor);
  files.sort((a, b) => a.index - b.index);
  console.log(`Found ${files.length} enrichment blobs.`);

  // 2. Find files with empty basis but a runId
  console.log("Scanning for empty-basis files…");
  const scan = await mapWithConcurrency(files, 24, async (f) => {
    try {
      const res = await fetch(f.downloadUrl, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (!res.ok) return null;
      const entry: BlobEntry = await res.json();
      const hasBasis = Array.isArray(entry.basis) && entry.basis.length > 0;
      return { ...f, entry, hasBasis, runId: entry.runId };
    } catch {
      return null;
    }
  });

  const targets = scan.filter((s): s is NonNullable<typeof s> => !!s && !s.hasBasis && !!s.runId);
  const noRun = scan.filter((s) => s && !s.hasBasis && !s.runId).length;
  console.log(`Empty basis: ${scan.filter((s) => s && !s.hasBasis).length} (with runId: ${targets.length}, without: ${noRun})`);

  if (DRY) {
    console.log("Dry run — sample targets:", targets.slice(0, 5).map((t) => ({ index: t.index, runId: t.runId })));
    return;
  }

  // 3. Recover basis from each runId and re-upload
  let fixed = 0, failed = 0, empty = 0;
  await mapWithConcurrency(targets, 12, async (t) => {
    const basis = await fetchResultBasis(t.runId!);
    if (!basis) { failed++; return; }
    if (basis.length === 0) { empty++; return; }
    const updated = { ...t.entry, basis, basisBackfilledAt: new Date().toISOString() };
    try {
      await put(t.pathname, JSON.stringify(updated), {
        access: "private", allowOverwrite: true, contentType: "application/json", token: TOKEN,
      });
      fixed++;
      if (fixed % 50 === 0) console.log(`  …${fixed} fixed`);
    } catch (e) {
      failed++;
      console.error(`  put failed idx ${t.index}:`, (e as Error).message);
    }
  });

  console.log(`\nDone. Fixed: ${fixed}, run had empty basis: ${empty}, failed: ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
