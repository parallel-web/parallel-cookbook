/**
 * GICS sector and industry for every company in config/companies.json that has
 * no profile on the current spec (one base Task run each, about $0.01).
 *
 *   pnpm profiles
 */
import { parallelClient, publicError } from "../src/parallel/client";
import { profileCompanies } from "../src/sheet/profile";
import { readCoverageConfig } from "../src/store";
import { loadEnv } from "./lib/env";

loadEnv();
try {
  await profileCompanies(parallelClient(), readCoverageConfig().companies, (line) => console.log(line));
} catch (error) {
  console.error(publicError(error));
  process.exit(1);
}
