"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { fmtDate } from "../lib/dates";
import type { SheetData } from "../lib/types";
import { outcomeWord, sourceLine, statementsOf } from "../lib/view";
import { Stance, StatementText } from "./Marks";
import { TearSheet } from "./TearSheet";

const DOC: Record<string, string> = {
  earnings_release: "earnings release",
  prepared_remarks: "prepared remarks",
  shareholder_letter: "shareholder letter",
  investor_day: "investor day",
  sec_filing: "SEC filing",
  press_release: "press release",
};

const W = 816;
const H = 1056;

/**
 * A company: its tear sheet, scaled to fit, and the paper trail of whichever
 * promise is picked on the sheet.
 */
export function SheetView({ sheet, today, initialFocus }: { sheet: SheetData; today: string; initialFocus: string | null }) {
  const [focus, setFocus] = useState(initialFocus && sheet.promises.some((p) => p.id === initialFocus) ? initialFocus : sheet.focus);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setScale(Math.min(1, inner / W));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pick = (pid: string) => {
    setFocus(pid);
    window.history.replaceState(null, "", `/sheet/${sheet.ticker}?focus=${pid}`);
  };

  const promise = sheet.promises.find((p) => p.id === focus) ?? sheet.promises[0];
  const trail = statementsOf(sheet, promise.id);

  return (
    <>
      <div className="bar no-print">
        <Link href="/">← All companies</Link>
        <button type="button" onClick={() => window.print()}>
          Print / PDF
        </button>
      </div>
      <div ref={box} className="sheet-fit" style={{ width: W * scale, height: H * scale }}>
        <div style={{ transform: `scale(${scale})` }}>
          <TearSheet sheet={sheet} today={today} focus={promise.id} onPick={pick} />
        </div>
      </div>
      <p className="hint no-print">Pick a promise on the sheet to see every statement about it.</p>

      <section className="trail no-print" aria-live="polite">
        <div className="trail-head">
          <span className="lbl">
            Paper trail · {promise.id} · {outcomeWord(promise)}
          </span>
          <h2>{promise.label}</h2>
          <span style={{ color: "var(--ink-2)" }}>{promise.commitment}</span>
          {promise.factCheck && promise.factCheck.verdict === "correct" ? (
            <span className="check">
              Outcome confirmed by independent fact-check.
              {promise.factCheck.held ? ` ${promise.factCheck.held} statement${promise.factCheck.held === 1 ? "" : "s"} held back for a date it could not confirm.` : ""}
            </span>
          ) : null}
        </div>
        {trail.map((s) => (
          <div key={s.id} className="entry">
            <span className="when">
              <span>{fmtDate(s.date)}</span>
              <Stance s={s} />
            </span>
            <div>
              <p className="quote">
                <StatementText s={s} />
              </p>
              <p className="src">
                {[s.call, s.sourceType && DOC[s.sourceType] && !s.call.toLowerCase().includes(DOC[s.sourceType]) ? DOC[s.sourceType] : null, s.speaker].filter(Boolean).join(" · ")}
                {" · "}
                {s.verbatim ? (
                  <a href={s.verbatim.backing.url} target="_blank" rel="noreferrer">
                    {sourceLine(s)}
                  </a>
                ) : (
                  sourceLine(s)
                )}
              </p>
            </div>
          </div>
        ))}
        <p className="src" style={{ marginTop: 14, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-3)" }}>
          Outcome: {promise.outcomeSummary}
        </p>
      </section>
    </>
  );
}
