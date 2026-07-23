/**
 * Uploads the full enrichments.json to Vercel Blob.
 * The compact version stays in git for table columns.
 * The full version is fetched on-demand for basis/citations.
 *
 * Usage: BLOB_READ_WRITE_TOKEN=vercel_blob_xxx npx tsx scripts/upload-enrichments.ts
 */

import * as fs from "fs";
import { put } from "@vercel/blob";

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("Set BLOB_READ_WRITE_TOKEN env var first.");
    console.error("Get it from: Vercel Dashboard → Project → Storage → Blob → Tokens");
    process.exit(1);
  }

  const filePath = "./public/data/enrichments.json";
  if (!fs.existsSync(filePath)) {
    console.error("No enrichments.json found.");
    process.exit(1);
  }

  const fileSize = fs.statSync(filePath).size;
  console.log(`Uploading enrichments.json (${(fileSize / 1024 / 1024).toFixed(1)}MB)...`);

  const fileBuffer = fs.readFileSync(filePath);

  const blob = await put("enrichments.json", fileBuffer, {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });

  console.log(`\nUploaded to: ${blob.url}`);
  console.log(`\nSet this env var in Vercel:`);
  console.log(`  ENRICHMENTS_BLOB_URL=${blob.url}`);

  // Also save the URL locally
  fs.writeFileSync(".env.local",
    fs.readFileSync(".env.local", "utf-8").replace(/ENRICHMENTS_BLOB_URL=.*/g, "").trim() +
    `\nENRICHMENTS_BLOB_URL=${blob.url}\n`
  );
  console.log(`\nSaved to .env.local`);
}

main().catch(console.error);
