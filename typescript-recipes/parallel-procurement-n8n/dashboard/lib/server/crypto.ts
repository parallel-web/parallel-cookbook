import "server-only";
import { env } from "./env";

const ENC_ALGO = "AES-GCM";
const IV_LENGTH = 12;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) {
    throw new Error("APP_ENCRYPTION_KEY must be a hex string with even length");
  }
  const buffer = new ArrayBuffer(clean.length / 2);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  if (view.buffer instanceof ArrayBuffer && view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer;
  }
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

async function getKey(): Promise<CryptoKey> {
  const raw = hexToBytes(env().APP_ENCRYPTION_KEY);
  if (raw.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${raw.length}).`,
    );
  }
  return await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(raw),
    { name: ENC_ALGO },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext string with AES-GCM. Returns a Uint8Array layout of
 * [12 bytes IV] [ciphertext+tag]. Stored in Postgres as bytea.
 */
export async function encryptApiKey(plaintext: string): Promise<Uint8Array> {
  const key = await getKey();
  const ivBuf = new ArrayBuffer(IV_LENGTH);
  const iv = new Uint8Array(ivBuf);
  crypto.getRandomValues(iv);
  const data = new TextEncoder().encode(plaintext);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: ENC_ALGO, iv: ivBuf }, key, toArrayBuffer(data)),
  );
  const outBuf = new ArrayBuffer(IV_LENGTH + cipher.length);
  const out = new Uint8Array(outBuf);
  out.set(iv, 0);
  out.set(cipher, IV_LENGTH);
  return out;
}

export async function decryptApiKey(payload: Uint8Array): Promise<string> {
  if (payload.length <= IV_LENGTH) {
    throw new Error("Encrypted payload is too short");
  }
  const key = await getKey();
  const iv = toArrayBuffer(payload.slice(0, IV_LENGTH));
  const cipher = toArrayBuffer(payload.slice(IV_LENGTH));
  const plain = await crypto.subtle.decrypt({ name: ENC_ALGO, iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

export function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", toArrayBuffer(data)).then((buf) => {
    const bytes = new Uint8Array(buf);
    let out = "";
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
    return out;
  });
}

/**
 * Decode a Postgres bytea value returned by supabase-js as a base64 string
 * with `\x` hex prefix or as a string of bytes. Supabase typically returns
 * bytea as a hex-prefixed string ("\\xDEADBEEF"), but the JS driver may also
 * give us a plain Uint8Array. Handle both.
 */
export function byteaToBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      const hex = value.slice(2);
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    // base64 fallback
    const buf = Buffer.from(value, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  throw new Error("Unsupported bytea representation from Supabase");
}

export function bytesToBytea(bytes: Uint8Array): string {
  let hex = "\\x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
