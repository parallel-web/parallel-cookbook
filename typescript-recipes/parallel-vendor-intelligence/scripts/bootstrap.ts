import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { createVendorIntelligenceFromEnv } from "../src/config.js";
import { VendorSchema } from "../src/schema.js";

const { values } = parseArgs({
  options: {
    vendors: { type: "string", short: "v", default: "examples/vendors.json" },
  },
});

const vendorPath = resolve(process.cwd(), values.vendors!);
const vendors = z.array(VendorSchema).parse(JSON.parse(await readFile(vendorPath, "utf8")));
const summary = await createVendorIntelligenceFromEnv().bootstrap(vendors);
console.log(JSON.stringify(summary, null, 2));
