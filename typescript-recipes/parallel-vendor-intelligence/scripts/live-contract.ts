import "dotenv/config";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

type LiveLogger = Pick<Console, "log">;

export interface LiveContractSummary {
  taskRunId: string;
  monitorId: string;
  basisEntries: number;
  eventCount: number;
  cancelled: true;
}

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
      if (Date.now() + RETRY_DELAY_MILLISECONDS >= deadline) break;
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, RETRY_DELAY_MILLISECONDS),
      );
    }
  }

  throw new Error(`Task ${runId} did not complete within ${RESULT_MAX_WAIT_SECONDS} seconds.`, {
    cause: lastError,
  });
}

export async function runLiveContract(options: {
  apiKey: string;
  client?: ParallelPort;
  logger?: LiveLogger;
}): Promise<LiveContractSummary> {
  const logger = options.logger ?? console;
  const vendor = VendorSchema.parse({
    name: "Cloudflare",
    domain: "cloudflare.com",
  });
  const client: ParallelPort =
    options.client ?? new Parallel({ apiKey: options.apiKey, timeout: 60_000 });

  logger.log(`Creating a disposable baseline Task for ${vendor.domain}...`);
  const taskRun = await client.taskRun.create(buildBaselineTaskParams(vendor));
  logger.log(`Task created: ${taskRun.run_id}`);

  const result = await waitForTaskResult(client, taskRun.run_id);
  if (result.output.type !== "json") {
    throw new Error(`Expected JSON Task output, received ${result.output.type}.`);
  }
  VendorReportSchema.parse(result.output.content);
  const basisEntries = result.output.basis.length;
  logger.log(`Task completed with ${basisEntries} basis entries.`);

  let monitorId: string | undefined;
  let eventCount = 0;
  let cancelled = false;
  try {
    const monitor = await client.monitor.create({
      type: "snapshot",
      frequency: "30d",
      processor: "lite",
      settings: { task_run_id: taskRun.run_id },
      metadata: {
        recipe: "vendor-intel",
        vendor: vendor.domain,
        smoke: "true",
      },
    });
    monitorId = monitor.monitor_id;
    logger.log(`Snapshot Monitor created: ${monitorId}`);

    const retrieved = await client.monitor.retrieve(monitorId);
    if (
      retrieved.type !== "snapshot" ||
      !("task_run_id" in retrieved.settings) ||
      retrieved.settings.task_run_id !== taskRun.run_id
    ) {
      throw new Error("Retrieved Monitor did not preserve the snapshot Task contract.");
    }

    const page = await client.monitor.events(monitorId, { limit: 1 });
    eventCount = page.events.length;
    logger.log(`Monitor retrieval succeeded; event page contains ${eventCount} event(s).`);
  } finally {
    if (monitorId) {
      const cancellation = await client.monitor.cancel(monitorId);
      const confirmed =
        cancellation.status === "cancelled"
          ? cancellation
          : await client.monitor.retrieve(monitorId);
      if (confirmed.status !== "cancelled") {
        throw new Error(`Monitor ${monitorId} did not reach cancelled status.`);
      }
      cancelled = true;
      logger.log(`Cancelled disposable Monitor: ${monitorId}`);
    }
  }

  if (!monitorId || !cancelled) {
    throw new Error("Live contract did not create and cancel a disposable Monitor.");
  }
  return {
    taskRunId: taskRun.run_id,
    monitorId,
    basisEntries,
    eventCount,
    cancelled: true,
  };
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) throw new Error("Set PARALLEL_API_KEY before running npm run smoke:live.");
  await runLiveContract({ apiKey });
}
