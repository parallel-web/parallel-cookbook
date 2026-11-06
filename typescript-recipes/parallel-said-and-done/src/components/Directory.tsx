"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ADD_COMPANY_URL } from "../lib/site";
import { RemoteImg } from "./RemoteImg";

export interface DirectoryCard {
  ticker: string;
  short: string;
  exchange: string;
  sector: string | null;
  industry: string | null;
  logo: string | null;
  status: string;
  statusClass: string;
  soon: boolean;
  when: string;
  tally: string;
  /** One line per promise: where its statements fall on the 2021 → today axis. */
  tracks: { line: { l: number; w: number }; dots: { l: number; k: string }[] }[];
}

const FIRST = 25;

/** Short chip labels for GICS sectors; the full name shows on hover. */
const SECTOR_LABEL: Record<string, string> = {
  "Information Technology": "Tech",
  "Communication Services": "Media & telecom",
  "Consumer Discretionary": "Consumer",
  "Consumer Staples": "Staples",
  Financials: "Financials",
  "Health Care": "Health care",
  Industrials: "Industrials",
  Energy: "Energy",
  Materials: "Materials",
  Utilities: "Utilities",
  "Real Estate": "Real estate",
};

function Logo({ c }: { c: DirectoryCard }) {
  const chip = (
    <span className="chip" style={{ width: 28, height: 28, fontSize: 8 }}>
      {c.ticker}
    </span>
  );
  if (!c.logo) return chip;
  return (
    <span className="card-logo">
      <RemoteImg src={c.logo} alt={`${c.short} logo`} fallback={chip} />
    </span>
  );
}

export function Directory({ cards }: { cards: DirectoryCard[] }) {
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const sectors = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of cards) if (c.sector) n.set(c.sector, (n.get(c.sector) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]);
  }, [cards]);
  const soon = cards.filter((c) => c.soon).length;
  // The full list is long: show five rows until asked, unless a filter or search narrows it.
  const q = query.trim().toLowerCase();
  const shown = cards.filter(
    (c) =>
      (filter === "all" || (filter === "soon" ? c.soon : c.sector === filter)) &&
      (!q || c.short.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q) || (c.industry ?? "").toLowerCase().includes(q)),
  );

  return (
    <section className="directory" aria-label="Companies">
      <div className="dir-bar">
        <input className="dir-search" type="search" placeholder="Search companies or industries" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search companies" />
        <div className="chips" role="group" aria-label="Filter by sector">
          <button type="button" className="pill" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All <span className="n">{cards.length}</span>
          </button>
          {soon ? (
            <button type="button" className="pill" aria-pressed={filter === "soon"} onClick={() => setFilter("soon")}>
              Reporting soon <span className="n">{soon}</span>
            </button>
          ) : null}
          {sectors.map(([s, n]) => (
            <button key={s} type="button" className="pill" title={s} aria-pressed={filter === s} onClick={() => setFilter(s)}>
              {SECTOR_LABEL[s] ?? s} <span className="n">{n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid">
        {(all || filter !== "all" || q ? shown : shown.slice(0, FIRST)).map((c) => (
          <Link key={c.ticker} href={`/sheet/${c.ticker}`} className="card">
            <span className="card-top">
              <Logo c={c} />
              <span className={`status ${c.statusClass}`}>{c.status}</span>
            </span>
            <span>
              <b className="card-name">{c.short}</b>
              <span className="card-sub">
                {c.exchange} · {c.ticker}
                {c.industry ? ` · ${c.industry}` : ""}
              </span>
            </span>
            <span className="tracks" aria-label="Promise tracks, 2021 to today; orange marks a changed target">
              {c.tracks.map((t, i) => (
                <span key={i} className="track">
                  <span className="span" style={{ left: `${t.line.l}%`, width: `${t.line.w}%` }} />
                  {t.dots.map((d, j) => (
                    <span key={j} className={`dot ${d.k}`} style={{ left: `${d.l}%` }} />
                  ))}
                </span>
              ))}
            </span>
            <span className="card-foot">
              <span>{c.tally}</span>
              <span className="mono">{c.when}</span>
            </span>
          </Link>
        ))}
        {filter === "all" && !q && (all || shown.length <= FIRST) ? (
          <a href={ADD_COMPANY_URL} target="_blank" rel="noreferrer" className="card card-more">
            <span className="chip chip-more" style={{ width: 28, height: 28 }} aria-hidden>
              +
            </span>
            <b className="card-name">More companies on the way</b>
            <span className="card-sub">One Task run makes the sheet; a monitor keeps it current.</span>
          </a>
        ) : null}
        {shown.length === 0 ? <p className="card-sub">No companies match.</p> : null}
      </div>
      {!all && filter === "all" && !q && shown.length > FIRST ? (
        <div className="more-row">
          <button type="button" className="pill" onClick={() => setAll(true)}>
            Show all {shown.length} companies
          </button>
        </div>
      ) : null}
    </section>
  );
}
