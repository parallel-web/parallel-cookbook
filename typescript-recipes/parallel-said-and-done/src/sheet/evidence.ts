/**
 * Ties each dated statement to verbatim source text.
 *
 * The Task returns `basis` per list element (`statements.3`), each with cited
 * URLs and excerpts copied from those pages. A statement is shown upright only
 * when a passage from one of those excerpts (or from a later Search/Extract
 * fill) matches it; otherwise the sheet shows the Task's summary in italics.
 * The Task's own `quote` field is used to find the passage, never displayed.
 */
import type { Backing, Citation, SourceTier, Verbatim } from "../lib/types";
import {
  containsVerbatim,
  domainOf,
  keywordSet,
  markFigures,
  quoteLength,
  recall,
  sentences,
  shared,
  stripMarkdown,
  substantiveFigures,
} from "../lib/text";

/** Authored lists, disclosed in README: hosts for company releases and for call transcripts. */
const PRIMARY_HOSTS = ["sec.gov", "q4cdn.com", "q4inc.com", "gcs-web.com", "investis.com", "businesswire.com", "prnewswire.com", "globenewswire.com"];
const TRANSCRIPT_HOSTS = [
  "fool.com",
  "seekingalpha.com",
  "stockanalysis.com",
  "insidermonkey.com",
  "gurufocus.com",
  "marketbeat.com",
  "investing.com",
  "roic.ai",
  "finance.yahoo.com",
  "nasdaq.com",
  "earningscall.biz",
  "quartr.com",
  "capedge.com",
  "fintool.com",
  "alphaspread.com",
  "finance.biggo.com",
];

function registrable(host: string): string {
  const parts = host.split(".");
  return parts.slice(-2).join(".");
}

function hostMatches(host: string, list: string[]) {
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Company-owned domains: the configured website plus the investor-relations host the Task returned. */
export function companyDomains(website: string, irUrl: string | null | undefined): string[] {
  const out = new Set<string>([registrable(website.replace(/^www\./, ""))]);
  if (irUrl) out.add(registrable(domainOf(irUrl)));
  return [...out];
}

export function tierOf(url: string, ownDomains: string[]): SourceTier {
  const host = domainOf(url).toLowerCase();
  if (hostMatches(host, ownDomains) || hostMatches(host, PRIMARY_HOSTS)) return "primary";
  if (hostMatches(host, TRANSCRIPT_HOSTS)) return "transcript";
  return "press";
}

export function isTranscriptHost(url: string) {
  return hostMatches(domainOf(url).toLowerCase(), TRANSCRIPT_HOSTS);
}

export interface RawCitation {
  url: string;
  title?: string | null;
  excerpts?: string[] | null;
}

export function toCitation(raw: RawCitation, ownDomains: string[]): Citation {
  return { url: raw.url, title: raw.title ?? null, domain: domainOf(raw.url), tier: tierOf(raw.url, ownDomains) };
}

/** What a statement looks like to the matcher. */
export interface MatchTarget {
  quote: string | null;
  summary: string;
  /** Promise label and commitment, to reject passages about something else. */
  topic: string;
}

interface Window {
  text: string;
  citation: RawCitation;
}

/** The longest passage shown as a quote, in words. */
export const MAX_QUOTE_WORDS = 60;

/** A sentence too long to quote whole (often a bulleted list in a PDF) is split at semicolons, bullets and ", and" or ", but". */
function pieces(sentence: string): string[] {
  if (quoteLength(sentence) <= MAX_QUOTE_WORDS) return [sentence];
  return sentence
    .split(/(?<=;)\s+|(?<=；)\s*|\s+(?=•)|(?<=,)\s+(?=(?:and|but)\s)/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Candidate passages: one sentence or two in a row, each verbatim from an excerpt and at most MAX_QUOTE_WORDS long. */
function windowsOf(citations: RawCitation[]): Window[] {
  const out: Window[] = [];
  for (const citation of citations) {
    for (const excerpt of citation.excerpts ?? []) {
      const ss = sentences(excerpt).flatMap(pieces);
      for (let i = 0; i < ss.length; i += 1) {
        out.push({ text: ss[i], citation });
        if (i + 1 < ss.length) out.push({ text: `${ss[i]} ${ss[i + 1]}`, citation });
      }
    }
  }
  return out.filter((w) => {
    const words = quoteLength(w.text);
    return words >= 6 && words <= MAX_QUOTE_WORDS;
  });
}

export interface PassageMatch {
  text: string;
  citation: RawCitation;
  match: "exact" | "matched";
  score: number;
}

/**
 * Finds the passage that carries a statement. Rules, in order:
 *  1. exact: the Task's quote appears in the passage (case, quotes and spacing ignored);
 *  2. quote overlap: at least 75% of the quote's keywords appear in one passage;
 *  3. summary overlap: at least 45% of the summary's keywords and four shared
 *     keywords, sharing a figure whenever the summary has one, and touching the topic.
 */
export function findPassage(target: MatchTarget, citations: RawCitation[], ownDomains: string[], strict = false): PassageMatch | null {
  const windows = windowsOf(citations);
  if (windows.length === 0) return null;
  const tierRank = (w: Window) => ({ primary: 0, transcript: 1, press: 2 })[tierOf(w.citation.url, ownDomains)];

  if (target.quote) {
    const exact = windows
      .filter((w) => containsVerbatim(w.text, target.quote as string))
      .sort((a, b) => a.text.length - b.text.length || tierRank(a) - tierRank(b))[0];
    if (exact) return { text: exact.text, citation: exact.citation, match: "exact", score: 1 };
  }
  if (strict) return null;

  const summaryFigures = substantiveFigures(target.summary);
  const topic = keywordSet(target.topic);
  const summaryKeys = keywordSet(target.summary);
  let best: PassageMatch | null = null;
  let bestKey = -1;
  for (const w of windows) {
    const wKeys = keywordSet(w.text);
    if (shared(topic, wKeys).length === 0) continue;
    let score = 0;
    if (target.quote) {
      const r = recall(target.quote, w.text);
      if (r >= 0.75) score = r;
    }
    if (score === 0) {
      const r = recall(target.summary, w.text);
      const overlap = shared(summaryKeys, wKeys).length;
      const wFigures = substantiveFigures(w.text);
      const figureOk = summaryFigures.size === 0 || [...summaryFigures].some((f) => wFigures.has(f));
      if (r >= 0.45 && overlap >= 4 && figureOk) score = r * 0.9;
    }
    if (score === 0) continue;
    // Prefer higher score, then primary sources, then shorter passages.
    const key = score * 1000 - tierRank(w) * 10 - w.text.length / 1000;
    if (key > bestKey) {
      bestKey = key;
      best = { text: w.text, citation: w.citation, match: "matched", score };
    }
  }
  return best;
}

export function toVerbatim(found: PassageMatch, backing: Omit<Backing, "url" | "title" | "domain" | "tier">, ownDomains: string[]): Verbatim {
  const text = stripMarkdown(found.text);
  return {
    text,
    segs: markFigures(text),
    match: found.match,
    backing: {
      ...backing,
      url: found.citation.url,
      title: found.citation.title ?? null,
      domain: domainOf(found.citation.url),
      tier: tierOf(found.citation.url, ownDomains),
    },
  };
}

/* Same call? A statement's source should be the call or document the statement is dated to. */

const QWORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };

function year(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

/**
 * Quarter and year named together in a call name, title or file name: "Q4 FY2024",
 * "Fiscal Year 2024 Fourth Quarter", "Q4'24", "4Q25", "2025/q3". A year counts only
 * when it sits next to the quarter, so a folder like /2026/Feb/ is not read as one.
 */
export function periodOf(text: string | null | undefined): { q: number; y: number } | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/[_]/g, " ");
  const pats: [RegExp, (m: RegExpMatchArray) => { q: number; y: number }][] = [
    [/\bq([1-4])\s*[-' ’]?\s*(?:fy|fiscal(?: year)?)?\s*[-']?\s*(20\d\d|\d\d)(?!\d)/, (m) => ({ q: +m[1], y: year(m[2]) })],
    [/\b([1-4])q\s*[-' ’]?\s*(?:fy)?\s*(20\d\d|\d\d)(?!\d)/, (m) => ({ q: +m[1], y: year(m[2]) })],
    [/(first|second|third|fourth)[- ]quarter(?:\s+of)?\s+(?:fiscal(?:\s+year)?\s+|fy\s*)?(20\d\d)/, (m) => ({ q: QWORD[m[1]], y: year(m[2]) })],
    [/(?:fiscal(?:\s+year)?|fy)\s*(20\d\d|\d\d)\s+(first|second|third|fourth)[- ]quarter/, (m) => ({ q: QWORD[m[2]], y: year(m[1]) })],
    [/(20\d\d)\s+(first|second|third|fourth)[- ]quarter/, (m) => ({ q: QWORD[m[2]], y: year(m[1]) })],
    [/(?:fy)?(20\d\d)\s*[-/ ]\s*q([1-4])\b/, (m) => ({ q: +m[2], y: year(m[1]) })],
  ];
  for (const [re, f] of pats) {
    const m = t.match(re);
    if (m) return f(m);
  }
  return null;
}

/** A full date written in a title, e.g. "2026-01-15 BAC 4Q Earnings Call". */
function isoDateIn(text: string | null | undefined): string | null {
  return text?.match(/\b(20\d\d-\d\d-\d\d)\b/)?.[1] ?? null;
}

/**
 * False only when the source clearly names a different call: a dated title more
 * than a week from the statement, or a quarter and year that differ from the
 * statement's call. Unknown is not a mismatch.
 */
export function sameCall(call: string, source: { title: string | null; url: string }, date: string): boolean {
  const dated = isoDateIn(source.title);
  if (dated && Math.abs(Date.parse(dated) - Date.parse(date)) > 7 * 86_400_000) return false;
  const a = periodOf(call);
  const b = periodOf(source.title) ?? periodOf(decodeURIComponent(source.url.split("?")[0].split("/").slice(-1)[0] ?? ""));
  if (!a || !b) return true;
  return a.q === b.q && a.y === b.y;
}
