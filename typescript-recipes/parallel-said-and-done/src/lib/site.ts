/**
 * Where the source lives. Set NEXT_PUBLIC_SOURCE_URL when the app moves
 * (e.g. to parallel-cookbook); the header and the "more companies" card link here.
 */
export const SOURCE_URL =
  process.env.NEXT_PUBLIC_SOURCE_URL ||
  "https://github.com/parallel-web/parallel-cookbook/tree/main/typescript-recipes/parallel-said-and-done";

/** README section on adding a company. */
export const ADD_COMPANY_URL = `${SOURCE_URL}#keeping-it-current`;
