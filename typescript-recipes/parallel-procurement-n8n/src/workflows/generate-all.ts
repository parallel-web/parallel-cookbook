import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generateVendorSyncWorkflow } from "./generators/workflow1-vendor-sync.js";
import { generateDeepResearchWorkflow } from "./generators/workflow2-deep-research.js";
import { generateRiskScoringWorkflow } from "./generators/workflow3-risk-scoring.js";
import { generateMonitorWorkflow } from "./generators/workflow4-monitors.js";
import { generateAdHocWorkflow } from "./generators/workflow5-adhoc.js";
import { generateCombinedWorkflow } from "./generators/workflow-combined.js";

const workflows = [
  { name: "workflow1-vendor-sync.json", generate: generateVendorSyncWorkflow },
  { name: "workflow2-deep-research.json", generate: generateDeepResearchWorkflow },
  { name: "workflow3-risk-scoring.json", generate: generateRiskScoringWorkflow },
  { name: "workflow4-monitors.json", generate: generateMonitorWorkflow },
  { name: "workflow5-adhoc.json", generate: generateAdHocWorkflow },
  { name: "workflow-combined.json", generate: generateCombinedWorkflow },
];

async function main() {
  const outputDir = process.argv[2] || join(import.meta.dirname ?? ".", "output");
  await mkdir(outputDir, { recursive: true });

  for (const wf of workflows) {
    const json = wf.generate();
    const path = join(outputDir, wf.name);
    await writeFile(path, JSON.stringify(json, null, 2));
    console.log(`Generated: ${path}`);
  }

  console.log(`\nAll ${workflows.length} workflows generated in ${outputDir}`);
}

main().catch(console.error);
