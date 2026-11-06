/**
 * Re-runs Image Search for logos and photo plates, then rebuilds the sheets.
 *
 *   pnpm images              every company with a stored sheet run
 *   pnpm images MSFT
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { searchImages } from "../src/sheet/images";
import { readManifest, rebuild } from "../src/sheet/stored";
import { companyFor, readCoverageConfig, readSheet, writeRaw, writeSheet } from "../src/store";
import { loadEnv, positional } from "./lib/env";

loadEnv();
const picked = positional().map((t) => t.toUpperCase());
const tickers = picked.length ? picked : readCoverageConfig().companies.map((c) => c.ticker);
const client = parallelClient();
for (const ticker of tickers) {
  const manifest = readManifest(ticker);
  if (!manifest) continue;
  try {
    const before = rebuild(ticker);
    const images = await searchImages(client, companyFor(ticker), before.photoSubject, `said-and-done-images-${ticker}`);
    writeRaw(ticker, "images", "latest", images);
    writeRaw(ticker, "manifest", "latest", { ...manifest, images: true });
    const sheet = rebuild(ticker);
    if (readSheet(ticker)) writeSheet(sheet);
    console.log(`${ticker}: logo ${sheet.images.logo?.imageUrl ?? "none"} · photo ${sheet.images.photo?.imageUrl ?? "none"}`);
  } catch (error) {
    console.error(`${ticker}: ${publicError(error)}`);
  }
}
