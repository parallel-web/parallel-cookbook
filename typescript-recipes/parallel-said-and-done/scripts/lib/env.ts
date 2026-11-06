/**
 * Loads PARALLEL_API_KEY and friends for CLI scripts from this app's .env.local.
 * Existing env vars win.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadEnv(appRoot = process.cwd()) {
  for (const path of [join(appRoot, ".env.local")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

export function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : "true";
}

export function positional(): string[] {
  const out: string[] = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (a.startsWith("--")) {
      const next = process.argv[i + 1];
      if (next && !next.startsWith("--")) i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
