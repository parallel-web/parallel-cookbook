import "server-only";
import { env } from "./env";

/**
 * Parallel does not currently sign webhook bodies. We protect our webhook
 * endpoints by requiring a `t` query-string token derived from
 * HMAC(secret, "research" or "monitor"). Keys are stable for the lifetime of
 * a deploy.
 */
function toBuffer(input: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.byteLength);
  new Uint8Array(buf).set(input);
  return buf;
}

async function tokenFor(scope: string): Promise<string> {
  const secret = env().PARALLEL_WEBHOOK_SECRET;
  const key = await crypto.subtle.importKey(
    "raw",
    toBuffer(new TextEncoder().encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    toBuffer(new TextEncoder().encode(scope)),
  );
  return base64url(new Uint8Array(sig));
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function researchWebhookUrl(): Promise<string> {
  const token = await tokenFor("research");
  return `${env().APP_URL}/api/webhooks/parallel-task?t=${token}`;
}

export async function monitorWebhookUrl(): Promise<string> {
  const token = await tokenFor("monitor");
  return `${env().APP_URL}/api/webhooks/parallel-monitor?t=${token}`;
}

// The HMAC-SHA256 → base64url tokens we emit are always 43 chars. Anything
// dramatically longer is a malformed input — cap before doing any work so
// an attacker can't waste CPU forcing us to compute the expected token for
// a 10MB string. 256 is well above legitimate values.
const MAX_TOKEN_LENGTH = 256;

export async function verifyToken(
  scope: "research" | "monitor",
  presented: string | null,
): Promise<boolean> {
  if (!presented) return false;
  if (presented.length > MAX_TOKEN_LENGTH) return false;

  const expected = await tokenFor(scope);
  const expectedBytes = new TextEncoder().encode(expected);
  const presentedBytes = new TextEncoder().encode(presented);
  if (expectedBytes.length !== presentedBytes.length) return false;

  // Constant-time byte compare. We OR all the byte XORs together so the
  // loop runs to completion regardless of mismatch position, avoiding a
  // timing oracle.
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= expectedBytes[i] ^ presentedBytes[i];
  }
  return diff === 0;
}
