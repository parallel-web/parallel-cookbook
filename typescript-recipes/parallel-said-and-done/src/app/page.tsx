import Link from "next/link";

import { Directory, type DirectoryCard } from "../components/Directory";
import { SiteFooter, SiteHeader } from "../components/SiteHeader";
import { TearSheet } from "../components/TearSheet";
import { loadCoverage } from "../lib/data";
import { fmtDate, todayIso } from "../lib/dates";
import { asOfLine, callOf, countsOf, dueClass, dueWord, tally, trackOf } from "../lib/view";
import { MONITOR_FREQUENCY } from "../updates/spec";

export const dynamic = "force-dynamic";

// Three live renders of the template, fanned like papers on a desk (back to front).
const FAN = [
  { left: 236, top: 34, rotate: 5 },
  { left: 0, top: 48, rotate: -4 },
  { left: 118, top: 8, rotate: 1 },
];

/** A directory of companies: what each promised on earnings calls and how it turned out. */
export default function Companies() {
  const { sheets, profiles, asOf } = loadCoverage();
  const today = todayIso();
  const promises = sheets.reduce((n, s) => n + s.promises.length, 0);
  const since = sheets.map((s) => s.windowStart).sort()[0]?.slice(0, 4) ?? "2021";
  // Next call first, then the most recently reported.
  const ordered = [...sheets].sort((a, b) => {
    const ca = callOf(a, today);
    const cb = callOf(b, today);
    if (ca.upcoming !== cb.upcoming) return ca.upcoming ? -1 : 1;
    return ca.upcoming ? ca.date.localeCompare(cb.date) : cb.date.localeCompare(ca.date);
  });
  const cards: DirectoryCard[] = ordered.map((s) => {
    const c = callOf(s, today);
    const p = profiles[s.ticker];
    return {
      ticker: s.ticker,
      short: s.short,
      exchange: s.exchange,
      sector: p?.sector ?? null,
      industry: p?.industry ?? null,
      logo: s.images.logo?.imageUrl ?? null,
      status: dueWord(c.days).toUpperCase(),
      statusClass: dueClass(c.days),
      soon: c.upcoming && (c.days ?? 99) <= 14,
      when: `${c.quarter} · ${fmtDate(c.date).replace(/, \d{4}$/, "")}`,
      tally: tally(countsOf(s.promises)),
      // Each card's axis runs from the company's first statement to today, so its history fills the card.
      tracks: s.promises.map((x) => trackOf(s, x.id, s.statements.map((st) => st.date).sort()[0] ?? s.windowStart)),
    };
  });

  return (
    <div>
      <SiteHeader />
      <main className="wrap">
        <section className="hero">
          <div className="hero-text">
            <h1>Said &amp; done.</h1>
            <p>
              What {sheets.length} public companies promised on their earnings calls since {since}, and what happened. {promises} promises, each traced call by call
              with word-for-word quotes from the source.
            </p>
            <span className="live">
              <span className="live-dot" aria-hidden />
              Monitors check each company every {MONITOR_FREQUENCY.replace("h", " hours")}. More companies are added all the time.
            </span>
          </div>
          <div className="fan" aria-label="Three tear sheets, rendered from the template">
            {ordered
              .slice(0, 3)
              .reverse()
              .map((s, i) => (
                <Link
                  key={s.ticker}
                  href={`/sheet/${s.ticker}`}
                  aria-label={`Open the ${s.short} tear sheet`}
                  className="fan-sheet"
                  style={{ left: FAN[i].left, top: FAN[i].top, transform: `rotate(${FAN[i].rotate}deg)`, zIndex: i + 1 }}
                >
                  <span className="fan-scale">
                    <TearSheet sheet={s} today={today} links={false} />
                  </span>
                </Link>
              ))}
          </div>
        </section>

        <Directory cards={cards} />
      </main>
      <SiteFooter asOf={asOfLine(asOf)} />
    </div>
  );
}
