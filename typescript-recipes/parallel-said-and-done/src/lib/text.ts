/**
 * Deterministic text helpers. No model calls: matching, figure marking and
 * agreement checks are plain string rules so every result can be reproduced.
 */
import type { Seg } from "../lib/types";

/** Markdown from Extract and Search excerpts, flattened to the words on the page. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/^Section Title:.*$/gm, " ")
    .replace(/^Content:\s*/gm, "")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Canonical form for containment checks: case, quotes, dashes and spacing unified. */
export function normalize(text: string): string {
  return stripMarkdown(text)
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^a-z0-9$%.,'\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ABBREVIATIONS = /\b(?:U\.S|U\.K|Inc|Corp|Co|Ltd|Mr|Ms|Dr|St|vs|No|approx|e\.g|i\.e)\.$/i;

/** Splits page text into sentences, keeping abbreviations and decimals intact. */
export function sentences(text: string): string[] {
  const flat = stripMarkdown(text).replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
  if (!flat) return [];
  const out: string[] = [];
  let start = 0;
  // A footnote marker after the stop ("travel. ⁹ Now…") still ends the sentence.
  const re = /[.!?]["'”’)]?[⁰¹²³⁴-⁹]*\s+(?=[⁰¹²³⁴-⁹]*\s*["'“‘(]?[A-Z0-9$])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const end = m.index + m[0].trimEnd().length;
    const candidate = flat.slice(start, end);
    if (ABBREVIATIONS.test(candidate)) continue;
    out.push(candidate.trim());
    start = m.index + m[0].length;
  }
  const tail = flat.slice(start).trim();
  if (tail) out.push(tail);
  // PDF page numbers and footnote markers land at the start of the next sentence ("9 We anticipate…").
  return out.map((x) => x.replace(/^[⁰¹²³⁴-⁹]+\s*/, "").replace(/^\d{1,3}\s+(?=[A-Z][a-z])/, ""));
}

const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are as at be because been before being below between " +
    "both but by can could did do does doing down during each few for from further had has have having he her here " +
    "hers him his how i if in into is it its itself just let me more most my no nor not now of off on once only or " +
    "other our ours out over own same she should so some such than that the their theirs them then there these they " +
    "this those through to too under until up very was we were what when where which while who whom why will with " +
    "would you your yours us going think really know see thing things well yes okay ok right lot kind sort get got " +
    "say said says like just still continue continued expect expected expects quarter year call today " +
    "end total business company billion million percent results first second third fourth half full new next last " +
    "prior versus compared approximately roughly around level basis number range time way part term long near also " +
    "within across based overall well good great strong look looking forward"
  ).split(" "),
);

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  if (word.length > 4 && word.endsWith("e")) return word.slice(0, -1);
  return word;
}

/** Content words, lightly stemmed. Numbers are kept as words too. */
export function keywords(text: string): string[] {
  return normalize(text)
    .replace(/[$%,']/g, " ")
    .split(/[\s\-.]+/)
    .filter((w) => w.length > 2 || /^\d+$/.test(w))
    .filter((w) => !STOPWORDS.has(w))
    .map(stem);
}

export function keywordSet(text: string): Set<string> {
  return new Set(keywords(text));
}

export function shared(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((w) => b.has(w));
}

/**
 * Figures worth marking: money, percentages, counts with units, fiscal periods
 * and years. Ranges such as "$135-145 billion" are one figure.
 */
const FIGURE = new RegExp(
  [
    String.raw`\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:-|–|to)\s?\$?\d[\d,]*(?:\.\d+)?)?(?:\s?(?:trillion|billion|million|thousand|bn|mn|[BMK])\b)?`,
    String.raw`\b\d[\d,]*(?:\.\d+)?(?:\s?(?:-|–|to)\s?\d[\d,]*(?:\.\d+)?)?\s?(?:%|percent\b|percentage points?\b|basis points?\b|bps\b)`,
    String.raw`\b\d[\d,]*(?:\.\d+)?\s?(?:trillion|billion|million|thousand)\b`,
    String.raw`\b\d{1,3}(?:,\d{3})+\b`,
    String.raw`\b(?:FY|fiscal\s)'?\d{2,4}\b`,
    String.raw`\bQ[1-4](?:\s?(?:FY)?'?\d{2,4})?\b`,
    String.raw`\b[12]H\s?'?\d{2,4}\b|\bH[12](?:\s?'?\d{2,4})?\b`,
    String.raw`\b(?:19|20)\d{2}\b`,
    String.raw`\b\d+(?:\.\d+)?x\b`,
  ].join("|"),
  "gi",
);

/** Splits text into segments, marking each figure with h=1. */
export function markFigures(text: string): Seg[] {
  const segs: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(FIGURE)) {
    const i = m.index ?? 0;
    if (i > last) segs.push({ t: text.slice(last, i), h: 0 });
    segs.push({ t: m[0], h: 1 });
    last = i + m[0].length;
  }
  if (last < text.length) segs.push({ t: text.slice(last), h: 0 });
  return segs.length ? segs : [{ t: text, h: 0 }];
}

/** Numeric values inside the marked figures, for agreement checks ("$135 billion" → "135"). */
export function figureValues(text: string): Set<string> {
  const values = new Set<string>();
  for (const m of text.matchAll(FIGURE)) {
    for (const n of m[0].matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const v = n[0].replace(/,/g, "").replace(/\.0+$/, "");
      if (v) values.add(v);
    }
  }
  return values;
}

/** Figure values excluding years and fiscal-period labels (Q3, FY25, 1H 2026), which match too easily. */
export function substantiveFigures(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(FIGURE)) {
    const f = m[0];
    if (/^(?:19|20)\d{2}$/.test(f) || /^(?:Q[1-4]|[12]H|H[12]|FY|fiscal\s)/i.test(f)) continue;
    for (const v of figureValues(f)) out.add(v);
  }
  return out;
}

/** True when the normalized needle appears inside the normalized haystack. */
export function containsVerbatim(haystack: string, needle: string): boolean {
  const n = normalize(needle).replace(/[.,]+$/, "");
  if (n.length < 12) return false;
  return normalize(haystack).includes(n);
}

/** Share of the needle's keywords that appear in the candidate. */
export function recall(needle: string, candidate: string): number {
  const a = keywords(needle);
  if (a.length === 0) return 0;
  const b = keywordSet(candidate);
  return a.filter((w) => b.has(w)).length / a.length;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

