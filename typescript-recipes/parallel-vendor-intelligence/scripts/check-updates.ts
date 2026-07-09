import "dotenv/config";

import { parseArgs } from "node:util";

import { createVendorIntelligenceFromEnv } from "../src/config.js";

const { values } = parseArgs({
  options: {
    "retry-failed": { type: "boolean", default: false },
  },
});

const summary = await createVendorIntelligenceFromEnv().checkForUpdates({
  retryFailed: values["retry-failed"],
});
console.log(JSON.stringify(summary, null, 2));
if (summary.errors.length > 0) process.exitCode = 1;
