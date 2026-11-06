import type { Seg, SheetData, Statement } from "../lib/types";
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
  return (
    <>
      “<Segs segs={s.verbatim.segs} />”
    </>
  );
}

/** Stance tag. Orange only when the statement changed the target. */
export function Stance({ s }: { s: Pick<Statement, "k" | "stance"> }) {
  return <span className={`stamp${s.k === "c" ? " stamp-c" : ""}`}>{stanceText(s as Statement)}</span>;
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

/** Photo plate: the Image Search photo as a grey halftone, captioned with the Task's photo subject. */
export function Plate({ sheet, className, style }: { sheet: Pick<SheetData, "photoSubject" | "images">; className?: string; style?: React.CSSProperties }) {
  const photo = sheet.images?.photo;
  return (
    <span className={`plate${className ? ` ${className}` : ""}`} role="img" aria-label={`Photo: ${sheet.photoSubject}`} style={style}>
      {photo ? <RemoteImg src={photo.imageUrl} alt="" /> : null}
      <span className="plate-cap">Plate · {sheet.photoSubject}</span>
    </span>
  );
}
