/**
 * Re-runs Image Search for logos and photo plates, then rebuilds the sheets.
 *
 *   pnpm images                     every company with a stored sheet run
 *   pnpm images MSFT
 *   pnpm images --missing-photos    only the fallback photo search, for sheets without a photo
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { searchFallbackPhoto, searchImages, type ImagesRecord } from "../src/sheet/images";
import { readManifest, rebuild, writeManifest } from "../src/sheet/stored";
import { companyFor, readCoverageConfig, readRaw, readSheet, withLock, writeRaw, writeSheet } from "../src/store";
import { flag, loadEnv, positional } from "./lib/env";

loadEnv();
const picked = positional().map((t) => t.toUpperCase());
const tickers = picked.length ? picked : readCoverageConfig().companies.map((c) => c.ticker);
const missingOnly = flag("missing-photos") === "true";
const client = parallelClient();
for (const ticker of tickers) {
  try {
    await withLock(ticker, async () => {
      const manifest = await readManifest(ticker);
      if (!manifest) return;
      const before = await readSheet(ticker);
      if (!before || before.runs[0]?.runId !== manifest.sheetRunId) return;
      const company = companyFor(ticker);
      const session = `said-and-done-images-${ticker}`;
      let images: ImagesRecord;
      if (missingOnly) {
        if (before.images.photo) return;
        const stored = (await readRaw<ImagesRecord>(ticker, "images", manifest.sheetRunId)) ?? (await readRaw<ImagesRecord>(ticker, "images", "latest"));
        if (!stored) return;
        images = { ...stored, photoFallback: await searchFallbackPhoto(client, company, session) };
      } else {
        images = await searchImages(client, company, before.photoSubject, session, before.irUrl);
      }
      await writeRaw(ticker, "images", manifest.sheetRunId, images);
      await writeManifest(ticker, { ...manifest, images: true });
      const sheet = await rebuild(ticker);
      await writeSheet({ ...before, images: sheet.images });
      console.log(`${ticker}: logo ${sheet.images.logo ? "yes" : "none"} · photo ${sheet.images.photo?.imageUrl ?? "none"}`);
    });
  } catch (error) {
    console.error(`${ticker}: ${publicError(error)}`);
  }
}
