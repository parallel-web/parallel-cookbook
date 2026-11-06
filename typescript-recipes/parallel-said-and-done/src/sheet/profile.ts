/**
 * Company profile: one small Task run per company returns its GICS sector and
 * industry, so the directory can be filtered by sector with data from
 * Parallel rather than a hand-typed label.
 */
import type { Company } from "../lib/types";
import type { Parallel } from "../parallel/client";
import type { StoredRun } from "../parallel/task";
import { startRun } from "../pipeline/runs";
import { readProfiles, withLock, writeProfiles } from "../store";

/**
 * profile@1  lite; once returned a sector that does not contain its industry
 * profile@2  base; industry first, and the sector must be the one containing it
 */
export const PROFILE_SPEC_KEY = "profile@2";
export const PROFILE_PROCESSOR = "base";

export const GICS_SECTORS = [
  "Information Technology",
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Financials",
  "Health Care",
  "Industrials",
  "Energy",
  "Materials",
  "Utilities",
  "Real Estate",
] as const;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    gics_industry: {
      type: "string",
      description: "The company's current GICS industry as classified by MSCI and S&P, e.g. 'Semiconductors & Semiconductor Equipment'.",
    },
    gics_sector: {
      type: "string",
      enum: [...GICS_SECTORS],
      description:
        "The GICS sector that contains gics_industry in the GICS hierarchy, e.g. Electric Utilities is in Utilities and " +
        "Interactive Media & Services is in Communication Services.",
    },
  },
  required: ["gics_industry", "gics_sector"],
  additionalProperties: false,
} as const;

export function profileRequest(company: Company) {
  return {
    processor: PROFILE_PROCESSOR,
    input: { company_name: company.name, ticker: company.ticker, company_website: company.website },
    task_spec: {
      input_schema: {
        type: "json" as const,
        json_schema: {
          type: "object",
          properties: {
            company_name: { type: "string" },
            ticker: { type: "string" },
            company_website: { type: "string" },
          },
          required: ["company_name", "ticker", "company_website"],
          additionalProperties: false,
        },
      },
      output_schema: { type: "json" as const, json_schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> },
    },
    metadata: { app: "said-and-done", spec: PROFILE_SPEC_KEY, ticker: company.ticker },
    enable_events: false,
  };
}

/** Starts a profile run for a company with none on the current spec. Call with the company's lock held. */
export async function startProfile(client: Parallel, company: Company) {
  const have = await readProfiles();
  // A profile from an older spec is redone.
  if (have[company.ticker]?.spec === PROFILE_SPEC_KEY) return null;
  return startRun(client, company.ticker, "profile-run", profileRequest(company), PROFILE_SPEC_KEY);
}

/** Records a finished profile run in data/profiles.json, which every company shares. */
export async function recordProfile(ticker: string, stored: StoredRun) {
  const content = (stored.result?.output as { content?: { gics_sector?: string; gics_industry?: string } } | undefined)?.content;
  if (!content?.gics_sector) return false;
  await withLock("profiles", async () => {
    const profiles = await readProfiles();
    profiles[ticker] = { sector: content.gics_sector!, industry: content.gics_industry ?? "", spec: PROFILE_SPEC_KEY };
    await writeProfiles(profiles);
  });
  return true;
}
