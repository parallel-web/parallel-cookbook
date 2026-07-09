import "dotenv/config";

import { createVendorIntelligenceFromEnv } from "../src/config.js";

const summary = await createVendorIntelligenceFromEnv().cleanup();
console.log(JSON.stringify(summary, null, 2));
if (summary.failures.length > 0) process.exitCode = 1;
