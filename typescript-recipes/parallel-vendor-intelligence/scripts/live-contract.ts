import "dotenv/config";

import Parallel from "parallel-web";

import type { ParallelPort } from "../src/parallel-port.js";
import {
  buildBaselineTaskParams,
  VendorReportSchema,
  VendorSchema,
} from "../src/schema.js";

const RESULT_REQUEST_TIMEOUT_SECONDS = 25;
const RESULT_MAX_WAIT_SECONDS = 10 * 60;
const RETRY_DELAY_MILLISECONDS = 1_000;

async function waitForTaskResult(client: ParallelPort, runId: string) {
  const deadline = Date.now() + RESULT_MAX_WAIT_SECONDS * 1_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      return await client.taskRun.result(
        runId,
        { timeout: RESULT_REQUEST_TIMEOUT_SECONDS },
        { maxRetries: 0 },
      );
    } catch (error) {
      lastError = error;
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? (error as { status?: unknown }).status
          : undefined;
      if (status !== 408) throw error;
      if (Date.now() + RETRY_DELAY_MILLISECONDS >= deadline) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MILLISECONDS));
    }
  }

  throw new Error(`Task ${runId} did not complete within ${RESULT_MAX_WAIT_SECONDS} seconds.`, {
    cause: lastError,
  });
}

async function main(): Promise<void> {
  if (!process.env.PARALLEL_API_KEY) {
    throw new Error("Set PARALLEL_API_KEY before running npm run smoke:live.");
  }

  const vendor = VendorSchema.parse({
    name: "Cloudflare",
    domain: "cloudflare.com",
  });
  const client: ParallelPort = new Parallel({ apiKey: process.env.PARALLEL_API_KEY });

  console.log(`Creating a disposable baseline Task for ${vendor.domain}...`);
  const taskRun = await client.taskRun.create(buildBaselineTaskParams(vendor));
  console.log(`Task created: ${taskRun.run_id}`);

  const result = await waitForTaskResult(client, taskRun.run_id);
  if (result.output.type !== "json") {
    throw new Error(`Expected JSON Task output, received ${result.output.type}.`);
  }
  VendorReportSchema.parse(result.output.content);
  console.log(`Task completed with ${result.output.basis.length} basis entries.`);

  let monitorId: string | undefined;
  try {
    const monitor = await client.monitor.create({
      type: "snapshot",
      frequency: "30d",
      processor: "lite",
      settings: { task_run_id: taskRun.run_id },
      metadata: {
        recipe: "vendor-intel",
        vendor: vendor.domain,
      },
    });
    monitorId = monitor.monitor_id;
    console.log(`Snapshot Monitor created: ${monitorId}`);

    const retrieved = await client.monitor.retrieve(monitorId);
    if (
      retrieved.type !== "snapshot" ||
      !("task_run_id" in retrieved.settings) ||
      retrieved.settings.task_run_id !== taskRun.run_id
    ) {
      throw new Error("Retrieved Monitor did not preserve the snapshot Task contract.");
    }

    const page = await client.monitor.events(monitorId, { limit: 1 });
    console.log(`Monitor retrieval succeeded; event page contains ${page.events.length} event(s).`);
  } finally {
    if (monitorId) {
      await client.monitor.cancel(monitorId);
      console.log(`Cancelled disposable Monitor: ${monitorId}`);
    }
  }
}

await main();
