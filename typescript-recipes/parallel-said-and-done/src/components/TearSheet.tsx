import type { CSSProperties } from "react";

import { fmtDate } from "../lib/dates";
import type { SheetData } from "../lib/types";
import { axisYears, callOf, countsOf, dueWord, outcomeWord, sourceLine, stanceText, statementsOf, tally, trackOf, trailPick } from "../lib/view";
import { LogoChip, Plate, StatementText } from "./Marks";

/**
 * The tear sheet: one US Letter page per company, rendered from the sheet data
 * alone. `focus` picks the promise whose paper trail is shown (default: the
 * promise with the most verbatim excerpts, set by the build).
 */
export function TearSheet({
  sheet,
  today,
  focus,
  links = true,
  onPick,
}: {
  sheet: SheetData;
  today: string;
  focus?: string | null;
  links?: boolean;
  /** When set, each promise row is a button that picks the paper-trail promise. */
  onPick?: (pid: string) => void;
}) {
  // Thumbnails sit inside a link, so they render sources as text.
  const A = ({ href, children }: { href: string; children: React.ReactNode }) =>
    links ? (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  const call = callOf(sheet, today);
  const fid = focus && sheet.promises.some((p) => p.id === focus) ? focus : sheet.focus;
  const fp = sheet.promises.find((p) => p.id === fid) ?? sheet.promises[0];
  const { picks, rule } = trailPick(statementsOf(sheet, fp.id));
  const [y0, y1] = axisYears(sheet);
  // Five rows fit at 40 px; promises added by update runs shrink the rows to keep one page.
  const rowHeight = Math.min(40, Math.floor(200 / Math.max(5, sheet.promises.length)));
  const sheetRun = sheet.runs[0];
  const filled = sheet.fills.filled;
  const verbatim = sheet.statements.filter((s) => s.verbatim).length;
  const primary = sheet.sources.filter((s) => s.tier === "primary").length;
  const facts = [
    { k: call.upcoming ? "Next call" : "Last call", v: fmtDate(call.date) },
    { k: "Time", v: call.time ?? "—" },
    { k: "Quarter", v: call.quarter },
    { k: "Status", v: dueWord(call.days) },
  ];
  const made: { k: string; v: string }[] = [
    { k: "Task API", v: sheetRun ? `${sheetRun.spec} · ${sheetRun.processor}` : "—" },
    { k: "Run", v: sheetRun ? sheetRun.createdAt.slice(0, 10) : "—" },
    { k: "Search+Extract", v: `${filled} ${filled === 1 ? "excerpt" : "excerpts"} added` },
    { k: "Excerpts", v: `${verbatim} of ${sheet.statements.length} statements` },
  ];
  // Stages 2 and 3, when run: a history and a separate AI fact-check run per promise.
  const histories = sheet.runs.filter((r) => r.kind === "trail").length;
  const checked = sheet.promises.filter((p) => p.factCheck);
  if (histories) made[1] = { k: "Run", v: `${sheetRun?.createdAt.slice(0, 10)} + ${histories} promise histories` };
  if (checked.length) made.push({ k: "AI fact-check", v: `${checked.filter((p) => p.factCheck!.verdict === "correct" && !p.factCheck!.summaryErrors.length).length} of ${sheet.promises.length} outcomes confirmed` });

  return (
    <article className="ts" aria-label={`${sheet.name} promise tear sheet`}>
      <div className="ts-cut" />
      <div className="ts-run">
        <span>Said &amp; Done · Promise tear sheet</span>
        <span>
          Data as of {fmtDate(sheet.asOf)} · v{sheet.version}
        </span>
      </div>

      <section className="ts-head">
        <LogoChip sheet={sheet} size={44} />
        <div className="ts-name">{sheet.name}</div>
        <div className="ts-sub">
          {sheet.exchange} · {sheet.ticker} · Fiscal year ends {sheet.fiscalYearEnd}
        </div>
        <Plate sheet={sheet} link={links} />
        <div className="ts-facts">
          {facts.map((f) => (
            <div key={f.k} className="ts-fact">
              <span>{f.k}</span>
              <span>{f.v}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ts-promises" style={{ "--row": `${rowHeight}px` } as CSSProperties}>
        <div className="ts-sec-title">
          <span>Promises</span>
          <span>{tally(countsOf(sheet.promises))}</span>
        </div>
        <div className="ts-grid ts-thead">
          <span />
          <span>Promise</span>
          <span>First said</span>
          <span>Last said</span>
          <span className="axis">
            <span>{y0}</span>
            <span>{y1}</span>
          </span>
          <span>Outcome</span>
        </div>
        {sheet.promises.map((p) => {
          const ss = statementsOf(sheet, p.id).filter(s => s.stance !== "not_mentioned");
          const track = trackOf(sheet, p.id);
          return (
            <div
              key={p.id}
              className={`ts-grid ts-row${p.id === fp.id ? " on" : ""}${onPick ? " pickable" : ""}`}
              {...(onPick
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-pressed": p.id === fp.id,
                    "aria-label": `Show the paper trail for ${p.id} ${p.label}`,
                    onClick: () => onPick(p.id),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onPick(p.id);
                      }
                    },
                  }
                : {})}
            >
              <span>{p.id}</span>
              <span title={p.commitment}>{p.label}</span>
              <span>{ss[0] ? fmtDate(ss[0].date) : "—"}</span>
              <span>{ss.at(-1) ? fmtDate(ss.at(-1)!.date) : "—"}</span>
              <span className="ts-track">
                <span className="base" />
                <span className="span" style={{ left: `${track.line.l}%`, width: `${track.line.w}%` }} />
                {track.dots.map((d, i) => (
                  <span key={i} className={`ts-dot ${d.k}`} style={{ left: `${d.l}%` }} />
                ))}
              </span>
              <span>
                <span className={`outcome outcome-${p.k}`}>{outcomeWord(p)}</span>
              </span>
            </div>
          );
        })}
        <div className="ts-key">
          <span>
            <span className="ts-dot" />
            Statement
          </span>
          <span>
            <span className="ts-dot c" />
            Target changed
          </span>
          <span>
            <span className="ts-dot x" />
            Not mentioned
          </span>
        </div>
      </section>

      <section className="ts-trail">
        <div className="ts-sec-title">
          <span>
            Paper trail · {fp.id} {fp.label}
          </span>
          <span>{rule}</span>
        </div>
        <div className="ts-quotes">
          {picks.map((s) => (
            <div key={s.id} className="ts-quote">
              <div className="top">
                <span className="date">{fmtDate(s.date)}</span>
                <span className={`stance ${s.k}`}>{stanceText(s)}</span>
              </div>
              <span className="call">{s.call}</span>
              <div className="text">
                <StatementText s={s} />
              </div>
              <span className="foot">
                {s.verbatim ? <A href={s.verbatim.backing.url}>{sourceLine(s)}</A> : s.citations[0] ? <A href={s.citations[0].url}>{sourceLine(s)}</A> : sourceLine(s)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="ts-bottom">
        <div>
          <div className="title">
            <span>Sources</span>
            <span className="m">
              Top 5 of {sheet.sources.length} · {primary} primary sources
            </span>
          </div>
          <div className="ts-list">
            {sheet.sources.slice(0, 5).map((x) => (
              <div key={x.n} className="ts-src">
                <A href={x.url}>
                  {x.title} <span className="d">· {x.domain}</span>
                </A>
                <span>{x.uses}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="title">
            <span>How this was made</span>
          </div>
          <div className="ts-list">
            {made.map((k) => (
              <div key={k.k} className="ts-made">
                <span>{k.k}</span>
                <span>{k.v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="ts-rule" />
      <div className="ts-disclaimer">Not investment advice. Generated from Parallel Task, Search and Extract output; no figures entered by hand.</div>
      <div className="ts-powered">
        <span>Powered by</span>
        <span className="pill-o">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/parallel-lockup-light.svg" alt="Parallel" />
        </span>
      </div>
    </article>
  );
}
