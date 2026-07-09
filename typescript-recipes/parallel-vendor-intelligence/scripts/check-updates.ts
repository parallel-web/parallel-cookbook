import "dotenv/config";

import { createVendorIntelligenceFromEnv } from "../src/config.js";

const summary = await createVendorIntelligenceFromEnv().checkForUpdates();
console.log(JSON.stringify(summary, null, 2));
if (summary.errors.length > 0) process.exitCode = 1;
