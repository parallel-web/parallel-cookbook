// Parallel's brand fonts are licensed and are not in this repository. If you
// have them, set BRAND_FONTS_DIR and this copies them into public/fonts
// (gitignored) and writes public/fonts/brand.css. Without them the app uses
// Geist and Geist Mono.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "../public/fonts");
const sources = [process.env.BRAND_FONTS_DIR, target].filter(Boolean);
const FACES = [
  { family: "Gerstner Programm", weight: 400, files: ["Gerstner-ProgrammRegular.woff2"] },
  { family: "Gerstner Programm", weight: 500, files: ["Gerstner-ProgrammMedium.woff2"] },
  { family: "NaN Holo", weight: 500, files: ["NaNHoloStandard-Medium.woff2"] },
  { family: "FT System Mono", weight: 400, files: ["FTSystemMono-Regular.woff2", "FTSystemMono-Regular.ttf"] },
];

mkdirSync(target, { recursive: true });
const css = [];
for (const face of FACES) {
  let found = null;
  for (const file of face.files) {
    const from = sources.map((dir) => join(dir, file)).find((p) => existsSync(p));
    if (!from) continue;
    if (from !== join(target, file)) copyFileSync(from, join(target, file));
    found = file;
    break;
  }
  if (!found) continue;
  const format = found.endsWith(".ttf") ? "truetype" : "woff2";
  css.push(`@font-face { font-family: "${face.family}"; src: url(/fonts/${found}) format("${format}"); font-weight: ${face.weight}; font-display: swap; }`);
}
const out = join(target, "brand.css");
if (css.length) writeFileSync(out, `${css.join("\n")}\n`);
else rmSync(out, { force: true });
console.log(css.length ? `[fonts] ${css.length} brand font faces in public/fonts` : "[fonts] no brand fonts found; using Geist");
