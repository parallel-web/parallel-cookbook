import { z } from "zod";

import { RiskLevelSchema, type RiskLevel } from "./schema.js";

export interface VendorIntelligenceConfig {
  monitorFrequency: string;
  followUpRiskThreshold: RiskLevel;
  baselineProcessor: string;
  monitorProcessor: "lite" | "base";
  followUpProcessor: string;
  taskResultPollSeconds: number;
  taskResultMaxWaitMilliseconds: number;
  taskResultRetryDelayMilliseconds: number;
}

export const MonitorFrequencySchema = z.string().refine((value) => {
  const match = /^(\d+)([hdw])$/.exec(value);
  if (!match) return false;
  const amount = Number(match[1]);
  const hours = amount * (match[2] === "h" ? 1 : match[2] === "d" ? 24 : 24 * 7);
  return hours >= 1 && hours <= 30 * 24;
}, "Monitor frequency must look like 12h, 1d, or 2w and be between 1h and 30d.");

export const VendorIntelligenceConfigSchema: z.ZodType<VendorIntelligenceConfig> = z
  .object({
    monitorFrequency: MonitorFrequencySchema,
    followUpRiskThreshold: RiskLevelSchema,
    baselineProcessor: z.string().min(1),
    monitorProcessor: z.enum(["lite", "base"]),
    followUpProcessor: z.string().min(1),
    taskResultPollSeconds: z.number().int().positive(),
    taskResultMaxWaitMilliseconds: z.number().int().positive(),
    taskResultRetryDelayMilliseconds: z.number().int().nonnegative(),
  })
  .strict();

export const DEFAULT_CONFIG: VendorIntelligenceConfig = {
  monitorFrequency: "1d",
  followUpRiskThreshold: "HIGH",
  baselineProcessor: "core",
  monitorProcessor: "lite",
  followUpProcessor: "pro",
  taskResultPollSeconds: 25,
  taskResultMaxWaitMilliseconds: 15 * 60 * 1_000,
  taskResultRetryDelayMilliseconds: 250,
};
