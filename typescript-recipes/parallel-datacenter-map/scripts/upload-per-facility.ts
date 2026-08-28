/**
 * Splits enrichments.json into per-facility files and uploads to Vercel Blob.
 * Each facility gets its own file: enrichments/0.json, enrichments/1.json, etc.
 * The basis endpoint then fetches just the one file it needs (~95KB vs 181MB).
 *
 * Usage: BLOB_READ_WRITE_TOKEN=xxx npx tsx scripts/upload-per-facility.ts
 */

import * as fs from "fs";
import { put } from "@vercel/blob";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

async function main() {
  if (!TOKEN) {
    console.error("Set BLOB_READ_WRITE_TOKEN env var.");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync("./public/data/enrichments.json", "utf-8"));
  const keys = Object.keys(data);
  console.log(`Uploading ${keys.length} per-facility files to Vercel Blob...\n`);

  let uploaded = 0;
  const BATCH = 20;

  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (key) => {
        const content = JSON.stringify(data[key]);
        await put(`enrichments/${key}.json`, content, {
          access: "private",
          allowOverwrite: true,
          contentType: "application/json",
          token: TOKEN,
        });
        uploaded++;
      })
    );
    process.stdout.write(`\r  ${uploaded} / ${keys.length}`);
  }

  console.log(`\n\nDone. ${uploaded} facility files uploaded.`);
  console.log("Basis endpoint can now fetch: enrichments/{facilityIndex}.json");
}

main().catch(console.error);
