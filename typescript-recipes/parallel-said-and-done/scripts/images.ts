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
      const before = await readSheet(ticker);
      if (!before || before.runs[0]?.runId !== manifest.sheetRunId) return;
      const images = await searchImages(client, companyFor(ticker), before.photoSubject, `said-and-done-images-${ticker}`);
      await writeRaw(ticker, "images", manifest.sheetRunId, images);
      await writeManifest(ticker, { ...manifest, images: true });
      const sheet = await rebuild(ticker);
      await writeSheet({ ...before, images: sheet.images });
      console.log(`${ticker}: logo ${sheet.images.logo?.imageUrl ?? "none"} · photo ${sheet.images.photo?.imageUrl ?? "none"}`);
    });
  } catch (error) {
    console.error(`${ticker}: ${publicError(error)}`);
  }
}
