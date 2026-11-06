import type { CSSProperties } from "react";

import type { Citation, Seg, SheetData, Statement } from "../lib/types";
import { segsOf, stanceText } from "../lib/view";
import { RemoteImg } from "./RemoteImg";

/** Text with auto-marked figures in bold. */
export function Segs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((g, i) => (g.h ? <b key={i} className="fig">{g.t}</b> : <span key={i}>{g.t}</span>))}
    </>
  );
}

/** Verbatim text in quotation marks; otherwise the Task's summary in grey italics. */
export function StatementText({ s }: { s: Statement }) {
  if (!s.verbatim) return <span className="summary"><Segs segs={segsOf(s)} /></span>;
  if (s.verbatim.match === "matched") return <><span>Source excerpt: </span><Segs segs={s.verbatim.segs} /></>;
  return (
    <>
      “<Segs segs={s.verbatim.segs} />”
    </>
  );
}

/** Stance tag, colour-coded by kind. Orange only when the statement changed the target. */
export function Stance({ s }: { s: Pick<Statement, "k" | "stance"> }) {
  return <span className={`stamp stamp-${s.k}`}>{stanceText(s as Statement)}</span>;
}

/** Square logo slot: the Image Search logo, else the ticker chip. */
export function LogoChip({ sheet, size = 32 }: { sheet: Pick<SheetData, "ticker" | "images" | "name">; size?: number }) {
  const style = { width: size, height: size, fontSize: size >= 48 ? 12 : size <= 30 ? 8.5 : 9 };
  const chip = (
    <span className="chip" style={style} aria-label={`${sheet.name} logo slot`}>
      {sheet.ticker}
    </span>
  );
  const logo = sheet.images?.logo;
  if (!logo) return chip;
  return (
    <span className="chip chip-logo" style={style} title={`Logo via Image Search · ${new URL(logo.sourcePageUrl).hostname.replace(/^www\./, "")}`}>
      <RemoteImg src={logo.imageUrl} alt={`${sheet.name} logo`} fallback={<span className="mono">{sheet.ticker}</span>} />
    </span>
  );
}

/**
 * Photo plate: the Image Search photo as a grey halftone, captioned with the
 * Task's photo subject and linked to the page it came from. Without a photo,
 * or when it fails to load, the plate shows the company's logo instead.
 */
export function Plate({
  sheet,
  className,
  style,
  link = false,
}: {
  sheet: Pick<SheetData, "photoSubject" | "images" | "name" | "ticker">;
  className?: string;
  style?: CSSProperties;
  link?: boolean;
}) {
  const photo = sheet.images?.photo;
  const logo = (
    <span className="plate-logo">
      <LogoChip sheet={sheet} size={40} />
    </span>
  );
  const body = (
    <>
      {photo ? <RemoteImg src={photo.imageUrl} alt="" fallback={logo} /> : logo}
      {/* Hidden by CSS when the logo stands in for the photo. */}
      <span className="plate-cap">Plate · {sheet.photoSubject}</span>
    </>
  );
  const cls = `plate${className ? ` ${className}` : ""}`;
  if (link && photo) {
    return (
      <a className={cls} style={style} href={photo.sourcePageUrl} target="_blank" rel="noreferrer" title={`Photo via Image Search · ${hostOf(photo.sourcePageUrl)}`} aria-label={`Photo: ${sheet.photoSubject}, from ${hostOf(photo.sourcePageUrl)}`}>
        {body}
      </a>
    );
  }
  return (
    <span className={cls} role="img" aria-label={photo ? `Photo: ${sheet.photoSubject}` : `${sheet.name} logo`} style={style}>
      {body}
    </span>
  );
}

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** Links to the pages a claim was drawn from, one per site: "a.com · b.com +2" (the rest in the tooltip). */
export function Cites({ citations, max = 3 }: { citations: Citation[]; max?: number }) {
  const unique = citations.filter((c, i) => citations.findIndex((x) => x.url === c.url) === i);
  if (!unique.length) return null;
  const shown = unique.filter((c, i) => unique.findIndex((x) => x.domain === c.domain) === i).slice(0, max);
  const rest = unique.filter((c) => !shown.includes(c));
  return (
    <span className="cites">
      {shown.map((c) => (
        <a key={c.url} href={c.url} target="_blank" rel="noreferrer" title={c.title ?? c.url}>
          {c.domain}
        </a>
      ))}
      {rest.length ? <span title={rest.map((c) => c.title ?? c.url).join("\n")}> +{rest.length}</span> : null}
    </span>
  );
}
