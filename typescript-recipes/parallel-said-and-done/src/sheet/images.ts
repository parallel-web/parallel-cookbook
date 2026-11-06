/**
 * Logos and photo plates from the Image Search API. The photo subject is the
 * sheet Task's `photo_subject` field; pick rules below are deterministic.
 * Images are linked, not copied: the page shows the source page beside each one.
 */
import type { Parallel } from "../parallel/client";

import type { Company, ImagePick } from "../lib/types";
import { companyDomains } from "./evidence";
import { imageSearch, type ImageSearchResponse } from "../parallel/client";
import { domainOf } from "../lib/text";

export interface ImagesRecord {
  logo: { request: Record<string, unknown>; response: ImageSearchResponse } | null;
  photo: { request: Record<string, unknown>; response: ImageSearchResponse } | null;
}

const LOGO_HOSTS = ["wikipedia.org", "wikimedia.org"];

function onHost(url: string, hosts: string[]) {
  const h = domainOf(url);
  return hosts.some((d) => h === d || h.endsWith(`.${d}`));
}

function toPick(r: ImageSearchResponse["results"][number], response: ImageSearchResponse, rank: number): ImagePick {
  return {
    imageUrl: r.image_url,
    sourcePageUrl: r.source_page_url,
    title: r.title,
    width: r.width,
    height: r.height,
    searchId: response.search_id,
    rank,
  };
}

/**
 * Logo rule: an SVG or PNG at least 120 px wide, from Wikimedia or the company's
 * own site, whose file name or title names the company. Wikimedia's current
 * "Company logo" files come first (a company's own site also hosts sub-brand
 * marks), archived revisions last; then a square mark before a wide wordmark.
 */
export function pickLogo(response: ImageSearchResponse, company: Company, irUrl: string | null): ImagePick | null {
  const own = companyDomains(company.website, irUrl);
  const host = (r: ImageSearchResponse["results"][number]) =>
    onHost(r.image_url, LOGO_HOSTS) ? (/\/archive\//.test(r.image_url) ? 1 : 0) : onHost(r.source_page_url, own) || onHost(r.image_url, own) ? 1 : 2;
  const square = (r: ImageSearchResponse["results"][number]) => (r.width && r.height && r.width / r.height >= 0.75 && r.width / r.height <= 1.5 ? 0 : 1);
  const names = companyTokens(company);
  const named = (r: ImageSearchResponse["results"][number]) => {
    const file = decodeURIComponent(r.image_url.split("?")[0].split("/").pop() ?? "");
    const text = `${file} ${r.title ?? ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
    return names.some((n) => text.includes(n));
  };
  const ok = response.results
    .map((r, i) => ({ r, rank: i + 1 }))
    .filter(({ r }) => /\.(svg|png|webp)(\?|$)/i.test(r.image_url) || /svg|png/i.test(r.image_url))
    .filter(({ r }) => !r.width || !r.height || (r.width >= 120 && r.width / r.height >= 0.6 && r.width / r.height <= 9))
    .filter(({ r }) => host(r) < 2 && named(r))
    .sort((a, b) => host(a.r) - host(b.r) || square(a.r) - square(b.r) || a.rank - b.rank);
  return ok[0] ? toPick(ok[0].r, response, ok[0].rank) : null;
}

/** Words that identify the company in a file name: "homedepot", "home", "jpmorgan", "jpm". */
function companyTokens(company: Company): string[] {
  const short = company.short.toLowerCase();
  const words = short.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const out = new Set([short.replace(/[^a-z0-9]/g, ""), ...words]);
  if (words[0] && words[0].length > 4) out.add(words[0].slice(0, 4));
  if (company.ticker.length >= 3) out.add(company.ticker.toLowerCase());
  // The website's name counts even when short, e.g. "3m" for 3m.com.
  const site = company.website.replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/gi, "").toLowerCase();
  return [...out].filter((w) => w.length >= 3).concat(site.length >= 2 ? [site] : []);
}

/**
 * Photo rule: landscape, at least 800 px wide, and published by the company
 * itself or on Wikimedia Commons, so the page shows no news or stock photos.
 * Company pages first. Without one, the sheet shows the plain halftone plate.
 */
export function pickPhoto(response: ImageSearchResponse, company: Company, irUrl: string | null): ImagePick | null {
  const own = companyDomains(company.website, irUrl);
  const ok = response.results
    .map((r, i) => ({ r, rank: i + 1 }))
    .filter(({ r }) => !/\.svg(\?|$)/i.test(r.image_url))
    .filter(({ r }) => r.width && r.height && r.width >= 800 && r.width / r.height >= 1.25 && r.width / r.height <= 2.4)
    .filter(({ r }) => onHost(r.source_page_url, own) || onHost(r.image_url, own) || onHost(r.image_url, LOGO_HOSTS) || onHost(r.source_page_url, LOGO_HOSTS));
  const ranked = ok.find(({ r }) => onHost(r.source_page_url, own)) ?? ok[0];
  return ranked ? toPick(ranked.r, response, ranked.rank) : null;
}

export async function searchImages(client: Parallel, company: Company, photoSubject: string, sessionId: string): Promise<ImagesRecord> {
  const logoRequest = { ...logoImageRequest(company), session_id: sessionId };
  const photoRequest = { ...photoImageRequest(company, photoSubject), session_id: sessionId };
  const [logo, photo] = await Promise.all([imageSearch(client, logoRequest), imageSearch(client, photoRequest)]);
  return { logo: { request: logoRequest, response: logo }, photo: { request: photoRequest, response: photo } };
}

export function picksFrom(record: ImagesRecord | null, company: Company, irUrl: string | null) {
  return {
    logo: record?.logo ? pickLogo(record.logo.response, company, irUrl) : null,
    photo: record?.photo ? pickPhoto(record.photo.response, company, irUrl) : null,
  };
}

export function logoImageRequest(company: Company) {
  return {
    objective: `The official corporate logo of ${company.name} (${company.website}), the current mark or wordmark on a plain background.`,
    // The third query reaches Wikimedia Commons, where the pick rule looks first.
    search_queries: [`${company.short} logo`, `${company.name} logo svg`, `${company.name} logo Wikimedia Commons`],
    mode: "advanced" as const,
    advanced_settings: { max_results: 15 },
  };
}

export function photoImageRequest(company: Company, subject: string) {
  return {
    objective: `A landscape photograph of ${subject}, showing the site or product itself, no logos or text overlays.`,
    search_queries: [subject.slice(0, 200), `${company.short} ${subject.split(" ").slice(-2).join(" ")} photo`.slice(0, 200)],
    mode: "advanced" as const,
    advanced_settings: { max_results: 10 },
  };
}

