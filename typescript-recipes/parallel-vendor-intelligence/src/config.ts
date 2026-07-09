import { resolve } from "node:path";

import Parallel from "parallel-web";

import type { ParallelPort } from "./parallel-port.js";
import { RiskLevelSchema } from "./schema.js";
import { FileStateStore } from "./state.js";
import {
  DEFAULT_CONFIG,
  VendorIntelligence,
  type VendorIntelligenceConfig,
} from "./vendor-intelligence.js";

export function parseMonitorFrequency(value: string): string {
  const match = /^(\d+)([hdw])$/.exec(value);
  if (!match) throw new Error("MONITOR_FREQUENCY must look like 12h, 1d, or 2w.");
  const amount = Number(match[1]);
  const unit = match[2]!;
  const hours = amount * (unit === "h" ? 1 : unit === "d" ? 24 : 24 * 7);
  if (hours < 1 || hours > 30 * 24) {
    throw new Error("MONITOR_FREQUENCY must be between 1h and 30d.");
  }
  return value;
}

export function configFromEnv(
  env: NodeJS.ProcessEnv,
): Pick<VendorIntelligenceConfig, "monitorFrequency" | "followUpRiskThreshold"> {
  return {
    monitorFrequency: parseMonitorFrequency(env.MONITOR_FREQUENCY ?? "1d"),
    followUpRiskThreshold: RiskLevelSchema.parse(
      env.FOLLOW_UP_RISK_THRESHOLD ?? "HIGH",
    ),
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
  const teachingConfig = configFromEnv(env);
  const config: VendorIntelligenceConfig = {
    ...DEFAULT_CONFIG,
    ...teachingConfig,
    ...options.config,
  };
  const client: ParallelPort =
    options.client ?? new Parallel({ apiKey: apiKey!, timeout: 60_000 });

  return new VendorIntelligence({
    client,
    store: new FileStateStore(
      options.stateDirectory ?? resolve(process.cwd(), ".vendor-intelligence"),
    ),
    config,
  });
}
