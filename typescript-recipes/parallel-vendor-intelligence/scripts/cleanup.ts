import "dotenv/config";

import { parseArgs } from "node:util";

import { createVendorIntelligenceFromEnv } from "../src/config.js";

const { values } = parseArgs({
  options: {
    vendor: { type: "string", multiple: true },
  },
});

const summary = await createVendorIntelligenceFromEnv().cleanup({
  ...(values.vendor ? { vendors: values.vendor } : {}),
});
console.log(JSON.stringify(summary, null, 2));
if (summary.monitors.some(({ status }) => status === "failed")) process.exitCode = 1;
