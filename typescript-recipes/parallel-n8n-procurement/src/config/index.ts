import { z } from "zod";
import "dotenv/config";

// ── Config Schema ──────────────────────────────────────────────────────────

const ConfigSchema = z.object({
  // Required — no defaults
  PARALLEL_API_KEY: z.string().min(1, "PARALLEL_API_KEY is required"),
  GOOGLE_SHEET_ID: z.string().min(1, "GOOGLE_SHEET_ID is required"),
  SLACK_WEBHOOK_URL: z.string().url("SLACK_WEBHOOK_URL must be a valid URL"),
  N8N_WEBHOOK_BASE_URL: z.string().url("N8N_WEBHOOK_BASE_URL must be a valid URL"),

  // With defaults
  PARALLEL_BASE_URL: z.string().url().default("https://api.parallel.ai"),
  RESEARCH_CRON: z.string().default("0 6 * * *"),
  SYNC_CRON: z.string().default("0 0 * * *"),
  BATCH_SIZE: z.coerce.number().int().positive().default(50),
  RESEARCH_PROCESSOR: z.string().default("ultra8x"),
  MONITOR_CADENCE_HIGH: z
    .enum(["hourly", "daily", "weekly", "every_two_weeks"])
    .default("daily"),
  MONITOR_CADENCE_STD: z
    .enum(["hourly", "daily", "weekly", "every_two_weeks"])
    .default("weekly"),
  MONITORS_PER_VENDOR_HIGH: z.coerce.number().int().positive().default(5),
  MONITORS_PER_VENDOR_STD: z.coerce.number().int().positive().default(2),

  // Slack channel routing
  SLACK_CHANNEL_CRITICAL: z.string().optional(),
  SLACK_CHANNEL_ALERT: z.string().optional(),
  SLACK_CHANNEL_DIGEST: z.string().optional(),
});

// ── Type Export ─────────────────────────────────────────────────────────────

export type AppConfig = z.infer<typeof ConfigSchema>;

// ── Loader ─────────────────────────────────────────────────────────────────

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config) return _config;

  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Configuration validation failed:\n${formatted}\n\nCheck your .env file or environment variables.`
    );
  }

  _config = result.data;
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
