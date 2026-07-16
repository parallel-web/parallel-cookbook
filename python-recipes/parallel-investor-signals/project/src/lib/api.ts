// Thin client for the local FastAPI backend. All Parallel calls happen
// server-side; this file only ever hits our own /api/* routes (proxied to
// :8000 in dev — see vite.config.ts).
import type {
  BulkJob,
  CustomFieldDef,
  CustomFieldResult,
  Depth,
  ResearchBrief,
  SignalsResponse,
} from "../types";
import { getAccessKey } from "./auth";

// Every /api call carries the demo access key; the backend gate enforces it.
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = getAccessKey();
  return key ? { ...extra, "x-demo-key": key } : extra;
}

export class ApiError extends Error {
  status: number;
  hint?: string;
  constructor(message: string, status: number, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

async function parseError(res: Response): Promise<never> {
  let detail = `Request failed (${res.status})`;
  let hint: string | undefined;
  try {
    const body = await res.json();
    const d = body.error ?? body.detail;
    // FastAPI validation errors return detail as an array of objects — keep
    // only string details so the UI never renders "[object Object]".
    if (typeof d === "string" && d) detail = d;
    else if (Array.isArray(d)) detail = "That input didn't validate — check the company name and try again.";
    hint = typeof body.hint === "string" ? body.hint : undefined;
  } catch {
    /* non-JSON error body — keep the generic message */
  }
  throw new ApiError(detail, res.status, hint);
}

export async function enrichCompany(
  query: string,
  depth: Depth,
  customFields: CustomFieldDef[] = [],
): Promise<ResearchBrief> {
  const res = await fetch("/api/enrich", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ query, depth, custom_fields: customFields }),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

// Research ONLY the given custom fields for a company (no account/contacts
// re-run). Used to append answers to a brief that's already on screen.
export async function enrichCustomFields(
  query: string,
  depth: Depth,
  customFields: CustomFieldDef[],
): Promise<{ custom_fields: CustomFieldResult[] }> {
  const res = await fetch("/api/enrich/custom", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ query, depth, custom_fields: customFields }),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function startBulk(
  companies: string[],
  depth: Depth,
  customFields: CustomFieldDef[] = [],
): Promise<{ job_id: string }> {
  const res = await fetch("/api/enrich/bulk", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      rows: companies.map((c) => ({ company: c })),
      depth,
      custom_fields: customFields,
    }),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function pollBulk(jobId: string): Promise<BulkJob> {
  const res = await fetch(`/api/enrich/bulk/${jobId}`, { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  return res.json();
}

// URL for the streaming CSV export (opened directly by the browser, which
// can't send headers — the gate also accepts the key as a query param).
export function bulkExportUrl(jobId: string): string {
  const key = getAccessKey();
  const qs = key ? `?key=${encodeURIComponent(key)}` : "";
  return `/api/enrich/bulk/${jobId}/export.csv${qs}`;
}

// --- Investor-monitoring signals ---
export async function getSignals(): Promise<SignalsResponse> {
  const res = await fetch("/api/signals", { headers: authHeaders() });
  if (!res.ok) await parseError(res);
  return res.json();
}

// Drain new monitor events through chained verification. Can take ~30-60s
// per event found; usually returns in seconds (no new events).
export async function refreshSignals(): Promise<{ available: boolean; checked: number; added: number }> {
  const res = await fetch("/api/signals/refresh", {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

// Verify a candidate passphrase against the backend gate (no Parallel call,
// costs nothing). Used by the unlock screen before storing the key.
export async function verifyAccessKey(candidate: string): Promise<boolean> {
  const res = await fetch("/api/auth/check", {
    headers: { "x-demo-key": candidate },
  });
  return res.ok;
}

export async function health(): Promise<{ status: string; key_loaded: boolean }> {
  const res = await fetch("/api/health");
  if (!res.ok) await parseError(res);
  return res.json();
}
