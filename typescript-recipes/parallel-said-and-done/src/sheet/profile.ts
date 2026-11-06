/**
 * Company profile: one small Task run per company returns its GICS sector and
 * industry, so the directory can be filtered by sector with data from
 * Parallel rather than a hand-typed label.
 */
import type { Company } from "../lib/types";
import type { Parallel } from "../parallel/client";
import { awaitGroup, groupResults, startGroup } from "../parallel/task";
import { readProfiles, writeProfiles, writeRaw } from "../store";

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

/** Profiles every company that has none yet, as one Task Group. */
export async function profileCompanies(client: Parallel, companies: Company[], log: (line: string) => void) {
  const have = readProfiles();
  // A profile from an older spec is redone.
  const todo = companies.filter((c) => have[c.ticker]?.spec !== PROFILE_SPEC_KEY);
  if (!todo.length) return;
  const { groupId, runIds } = await startGroup(client, todo.map(profileRequest), { app: "said-and-done", spec: PROFILE_SPEC_KEY });
  log(`profiles: group ${groupId}, ${runIds.length} of ${todo.length} runs accepted`);
  await awaitGroup(client, groupId, log);
  const profiles = readProfiles();
  for (const event of await groupResults(client, groupId)) {
    const ticker = String((event.run.metadata as Record<string, unknown> | null)?.ticker ?? "");
    const content = (event.output as { content?: { gics_sector?: string; gics_industry?: string } } | undefined)?.content;
    if (!ticker || !content?.gics_sector) continue;
    writeRaw(ticker, "profile", event.run.run_id, event);
    profiles[ticker] = { sector: content.gics_sector, industry: content.gics_industry ?? "", spec: PROFILE_SPEC_KEY };
  }
  writeProfiles(profiles);
  log(`profiles: ${Object.keys(profiles).length} companies profiled`);
}
