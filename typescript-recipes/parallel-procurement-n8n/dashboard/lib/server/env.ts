import "server-only";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See dashboard/.env.example.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

let cached: ReturnType<typeof load> | null = null;

function load() {
  const appUrl = required("NEXT_PUBLIC_APP_URL");
  let host: string;
  try {
    host = new URL(appUrl).host;
  } catch {
    throw new Error(`NEXT_PUBLIC_APP_URL must be a valid URL, got: ${appUrl}`);
  }

  return {
    APP_URL: appUrl,
    APP_HOST: host,
    SUPABASE_URL: required("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
    SESSION_SECRET: required("SESSION_SECRET"),
    APP_ENCRYPTION_KEY: required("APP_ENCRYPTION_KEY"),
    PARALLEL_WEBHOOK_SECRET: required("PARALLEL_WEBHOOK_SECRET"),
    PARALLEL_BASE_URL: optional("PARALLEL_BASE_URL") ?? "https://api.parallel.ai",
    PARALLEL_RESEARCH_PROCESSOR:
      optional("PARALLEL_RESEARCH_PROCESSOR") ?? "ultra8x",
    CRON_SECRET: optional("CRON_SECRET"),
  };
}

export function env() {
  if (!cached) cached = load();
  return cached;
}
