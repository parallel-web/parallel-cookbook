/**
 * verifyToken tests (finding 12):
 *  - rejects null / missing
 *  - rejects oversized presented value BEFORE computing the HMAC
 *  - rejects wrong-length tokens via constant-time byte compare
 *  - accepts a token computed against the same scope+secret
 *  - rejects a token from the other scope
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/server/env", () => ({
  env: () => ({ PARALLEL_WEBHOOK_SECRET: "verify-token-test-secret-12345", APP_URL: "https://x" }),
}));

// Spy on subtle.sign so we can prove the oversized-input cap skips the HMAC.
const signSpy = vi.spyOn(crypto.subtle, "sign");

beforeEach(() => {
  signSpy.mockClear();
  vi.resetModules();
});

describe("verifyToken", () => {
  it("returns false on null/empty presented", async () => {
    const { verifyToken } = await import("@/lib/server/webhook-token");
    expect(await verifyToken("research", null)).toBe(false);
    expect(await verifyToken("research", "")).toBe(false);
  });

  it("rejects an oversized presented value without computing the HMAC", async () => {
    const { verifyToken } = await import("@/lib/server/webhook-token");
    const huge = "a".repeat(257);
    expect(await verifyToken("research", huge)).toBe(false);
    expect(signSpy).not.toHaveBeenCalled();
  });

  it("accepts a freshly-minted token for the same scope", async () => {
    const { verifyToken, researchWebhookUrl } = await import("@/lib/server/webhook-token");
    const url = await researchWebhookUrl();
    const token = new URL(url).searchParams.get("t");
    expect(token).toBeTruthy();
    expect(await verifyToken("research", token)).toBe(true);
  });

  it("rejects a token minted for the other scope", async () => {
    const { verifyToken, monitorWebhookUrl } = await import("@/lib/server/webhook-token");
    const url = await monitorWebhookUrl();
    const token = new URL(url).searchParams.get("t");
    expect(await verifyToken("research", token)).toBe(false);
  });

  it("rejects mismatched-length tokens without iterating into a buffer overrun", async () => {
    const { verifyToken } = await import("@/lib/server/webhook-token");
    expect(await verifyToken("research", "abc")).toBe(false);
  });
});
