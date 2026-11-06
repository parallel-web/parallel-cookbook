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

const valueFlags = ["as-of", "compare", "date", "event", "processor", "quarter"];

export function flag(name: string, takesValue = valueFlags.includes(name)): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  if (!takesValue) return "true";
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return next;
}

export function positional(extraValueFlags: string[] = []): string[] {
  const out: string[] = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg.startsWith("--")) out.push(arg);
    else if ([...valueFlags, ...extraValueFlags].includes(arg.slice(2))) {
      flag(arg.slice(2), true);
      i += 1;
    }
  }
  return out;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
