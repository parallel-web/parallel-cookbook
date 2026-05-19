import { afterEach, describe, expect, it } from "vitest";
import { isCronAuthorized } from "@/lib/server/cron-auth";

function request(headers: Record<string, string>) {
  return { headers: new Headers(headers) } as never;
}

describe("isCronAuthorized", () => {
  const originalSecret = process.env.CRON_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("rejects a spoofed Vercel cron header without the bearer secret", () => {
    process.env.CRON_SECRET = "cron-secret";
    expect(isCronAuthorized(request({ "x-vercel-cron": "1" }))).toBe(false);
  });

  it("accepts the configured bearer secret", () => {
    process.env.CRON_SECRET = "cron-secret";
    expect(isCronAuthorized(request({ authorization: "Bearer cron-secret" }))).toBe(true);
  });

  it("rejects all requests when CRON_SECRET is not configured", () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(request({ authorization: "Bearer cron-secret" }))).toBe(false);
  });
});
