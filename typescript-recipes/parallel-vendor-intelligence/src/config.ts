import { resolve } from "node:path";

import Parallel from "parallel-web";

import type { ParallelPort } from "./parallel-port.js";
import { createParallelPort } from "./parallel-sdk-adapter.js";
import { FileStateStore } from "./state.js";
import { VendorIntelligence } from "./vendor-intelligence.js";
import {
  DEFAULT_CONFIG,
  VendorIntelligenceConfigSchema,
  type VendorIntelligenceConfig,
} from "./vendor-config.js";

export function configFromEnv(
  env: NodeJS.ProcessEnv,
): Pick<VendorIntelligenceConfig, "monitorFrequency" | "followUpRiskThreshold"> {
  const parsed = VendorIntelligenceConfigSchema.parse({
    ...DEFAULT_CONFIG,
    ...configValuesFromEnv(env),
  });
  return {
    monitorFrequency: parsed.monitorFrequency,
    followUpRiskThreshold: parsed.followUpRiskThreshold,
  };
}

function configValuesFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
  return {
    ...(env.MONITOR_FREQUENCY !== undefined
      ? { monitorFrequency: env.MONITOR_FREQUENCY }
      : {}),
    ...(env.FOLLOW_UP_RISK_THRESHOLD !== undefined
      ? { followUpRiskThreshold: env.FOLLOW_UP_RISK_THRESHOLD }
      : {}),
  };
}

export function createVendorIntelligenceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    client?: ParallelPort;
    stateDirectory?: string;
    config?: Partial<VendorIntelligenceConfig>;
  } = {},
): VendorIntelligence {
  const apiKey = env.PARALLEL_API_KEY;
  if (!apiKey && !options.client) {
    throw new Error("PARALLEL_API_KEY is required.");
  }
  const config = VendorIntelligenceConfigSchema.parse({
    ...DEFAULT_CONFIG,
    ...configValuesFromEnv(env),
    ...options.config,
  });
  const client: ParallelPort =
    options.client ??
    createParallelPort(new Parallel({ apiKey: apiKey!, timeout: 60_000 }));

  return new VendorIntelligence({
    client,
    store: new FileStateStore(
      options.stateDirectory ?? resolve(process.cwd(), ".vendor-intelligence"),
    ),
    config,
  });
}
