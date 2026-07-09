import "server-only";
import Parallel from "parallel-web";
import { env } from "./env";
import type { IntegrationProvider } from "./integrations";

export interface TestResult {
  ok: boolean;
  detail?: string;
  error?: string;
}

/**
 * Validate a provider secret by dispatching to the right test helper. Shared
 * between POST /api/integrations (creating) and PATCH
 * /api/integrations/[id] (rotating) so the rotate path can't silently
 * accept a non-functional key.
 */
export async function testProviderKey(
  provider: IntegrationProvider,
  secret: string,
): Promise<TestResult> {
  switch (provider) {
    case "parallel":
      return await testParallelKey(secret);
    case "slack":
      return await testSlackToken(secret);
    case "email":
      return await testResendKey(secret);
  }
}

// Provider-side validation/delivery requests are always best-effort + low
// priority. Cap each round-trip so a hung region can't stall an integration
// save or a webhook fan-out. Vercel's per-route maxDuration is a much
// blunter tool — this gives every provider call the same 5s budget.
const PROVIDER_HTTP_TIMEOUT_MS = 5_000;

/**
 * Race a fetch against a short AbortController timeout. Shared between the
 * Slack and Resend helpers; the Parallel SDK enforces its own timeout via
 * the `timeout` ClientOption so we don't wrap it here. Throws an Error with
 * `name === "AbortError"` on timeout, matching the spec-compliant fetch
 * behavior; callers should map that to a user-friendly timeout message.
 */
async function timedFetch(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  timeoutMs: number = PROVIDER_HTTP_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// ── Parallel ───────────────────────────────────────────────────────────────

/**
 * Validate a Parallel API key against a low-cost V1 endpoint. The previous
 * implementation hit `/v1beta/tasks/groups`, which still works today but
 * diverges from the rest of the codebase (everything else uses V1 via the
 * SDK). If Parallel sunsets v1beta the BYOK signup would silently break
 * (finding 16). Hitting V1 `monitor.list` via the SDK keeps the test
 * aligned with the API surface we actually depend on.
 */
export async function testParallelKey(apiKey: string): Promise<TestResult> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, error: "Key is empty" };
  const baseUrl = env().PARALLEL_BASE_URL;

  try {
    // The SDK's `timeout` option installs an internal AbortController and
    // throws `APIConnectionTimeoutError` when it fires — no need for a
    // second outer AbortController racing it (finding from review #1).
    const sdk = new Parallel({
      apiKey: trimmed,
      baseURL: baseUrl,
      maxRetries: 0,
      timeout: PROVIDER_HTTP_TIMEOUT_MS,
    });
    // `monitor.list({ limit: 1 })` returns an empty page for new accounts
    // and a single monitor for established ones — either way it's a 200
    // for a valid key. The SDK throws a typed APIError on 4xx/5xx.
    await sdk.monitor.list({ limit: 1 });
    return { ok: true, detail: "Key accepted by Parallel V1 API" };
  } catch (err) {
    // The abort/timeout subclasses BOTH extend `APIError` with
    // `status: undefined`, so the generic-APIError branch would otherwise
    // emit "Parallel returned undefined: " for what is actually a timeout.
    // Check the timeout/abort classes first.
    if (
      err instanceof Parallel.APIConnectionTimeoutError ||
      err instanceof Parallel.APIUserAbortError
    ) {
      return {
        ok: false,
        error: `Parallel key test timed out after ${PROVIDER_HTTP_TIMEOUT_MS / 1000}s`,
      };
    }
    if (err instanceof Parallel.APIConnectionError) {
      return {
        ok: false,
        error: `Parallel connection failed: ${err.message?.slice(0, 200) || "unknown"}`,
      };
    }
    if (err instanceof Parallel.APIError) {
      if (err.status === 401 || err.status === 403) {
        return { ok: false, error: `Parallel rejected this key (${err.status})` };
      }
      return {
        ok: false,
        error: `Parallel returned ${err.status}: ${err.message?.slice(0, 200) ?? ""}`,
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Slack ──────────────────────────────────────────────────────────────────

/**
 * Validate a Slack bot token by calling auth.test. Returns the team and bot
 * user info on success.
 */
export async function testSlackToken(token: string): Promise<TestResult> {
  const trimmed = token.trim();
  if (!trimmed.startsWith("xoxb-") && !trimmed.startsWith("xoxp-") && !trimmed.startsWith("xapp-")) {
    return { ok: false, error: "Slack tokens start with xoxb-, xoxp-, or xapp-" };
  }
  try {
    const res = await timedFetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${trimmed}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      team?: string;
      url?: string;
      user?: string;
    };
    if (body.ok) {
      return { ok: true, detail: `Connected to ${body.team ?? "Slack workspace"} as ${body.user ?? "bot"}` };
    }
    return { ok: false, error: body.error ? `slack:${body.error}` : `Slack rejected token (${res.status})` };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, error: `Slack token test timed out after ${PROVIDER_HTTP_TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface SlackPostInput {
  token: string;
  channel: string;
  text: string;
}

export async function postSlackMessage({
  token,
  channel,
  text,
}: SlackPostInput): Promise<TestResult> {
  try {
    const res = await timedFetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel, text }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (body.ok) return { ok: true };
    return { ok: false, error: body.error ?? `slack:${res.status}` };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, error: `Slack post timed out after ${PROVIDER_HTTP_TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Email (Resend) ─────────────────────────────────────────────────────────

/**
 * Validate a Resend API key by listing domains (cheap, returns 200 even
 * with no domains configured).
 */
export async function testResendKey(apiKey: string): Promise<TestResult> {
  const trimmed = apiKey.trim();
  if (!trimmed.startsWith("re_")) {
    return { ok: false, error: "Resend keys start with re_" };
  }
  try {
    const res = await timedFetch("https://api.resend.com/domains", {
      method: "GET",
      headers: { Authorization: `Bearer ${trimmed}` },
    });
    if (res.ok) return { ok: true, detail: "Resend key accepted" };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Resend rejected this key (${res.status})` };
    }
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Resend returned ${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, error: `Resend key test timed out after ${PROVIDER_HTTP_TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface SendEmailInput {
  apiKey: string;
  from: string;
  to: string | string[];
  subject: string;
  html: string;
}

export async function sendResendEmail(input: SendEmailInput): Promise<TestResult> {
  try {
    const res = await timedFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
    });
    if (res.ok) return { ok: true };
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Resend returned ${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, error: `Resend send timed out after ${PROVIDER_HTTP_TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
