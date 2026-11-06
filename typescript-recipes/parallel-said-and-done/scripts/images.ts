/**
 * Re-runs Image Search for logos and photo plates, then rebuilds the sheets.
 *
 *   pnpm images              every company with a stored sheet run
 *   pnpm images MSFT
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { searchImages } from "../src/sheet/images";
import { readManifest, rebuild, writeManifest } from "../src/sheet/stored";
import { companyFor, readCoverageConfig, readSheet, withLock, writeRaw, writeSheet } from "../src/store";
import { loadEnv, positional } from "./lib/env";

loadEnv();
const picked = positional().map((t) => t.toUpperCase());
const tickers = picked.length ? picked : readCoverageConfig().companies.map((c) => c.ticker);
const client = parallelClient();
for (const ticker of tickers) {
  try {
    await withLock(ticker, async () => {
      const manifest = await readManifest(ticker);
      if (!manifest) return;
      const before = await rebuild(ticker);
      const images = await searchImages(client, companyFor(ticker), before.photoSubject, `said-and-done-images-${ticker}`);
      await writeRaw(ticker, "images", "latest", images);
      await writeManifest(ticker, { ...manifest, images: true });
      const sheet = await rebuild(ticker);
      if (await readSheet(ticker)) await writeSheet(sheet);
      console.log(`${ticker}: logo ${sheet.images.logo?.imageUrl ?? "none"} · photo ${sheet.images.photo?.imageUrl ?? "none"}`);
    });
  } catch (error) {
    console.error(`${ticker}: ${publicError(error)}`);
  }
}
