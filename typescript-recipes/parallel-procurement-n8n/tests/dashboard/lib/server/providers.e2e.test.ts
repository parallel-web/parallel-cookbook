/**
 * End-to-end provider tests. Unlike providers.test.ts (which stubs
 * globalThis.fetch), this suite exercises the FULL network stack:
 *
 *   - A local http.Server stands in for a hung or 5xx region — proves the
 *     5s timeout is enforced by both the parallel-web SDK and our
 *     `timedFetch` helper end-to-end through real `fetch()`.
 *   - Optional real-upstream probes against api.parallel.ai, slack.com,
 *     and api.resend.com with intentionally-bogus credentials prove the
 *     401/rejection paths work over the real internet.
 *
 * Gated behind `RUN_PROVIDER_E2E=1` so this suite doesn't run in CI by
 * default (it consumes real time + outbound network for the optional
 * real-network probes).
 *
 * Usage:
 *   RUN_PROVIDER_E2E=1 npx vitest run tests/dashboard/lib/server/providers.e2e.test.ts
 *   RUN_PROVIDER_E2E=1 RUN_PROVIDER_E2E_REAL=1 npx vitest run tests/dashboard/lib/server/providers.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

const E2E_ENABLED = process.env.RUN_PROVIDER_E2E === "1";
const REAL_NETWORK = process.env.RUN_PROVIDER_E2E_REAL === "1";

// Skip the whole module unless explicitly enabled.
const d = E2E_ENABLED ? describe : describe.skip;

// Mutable base URL the mocked env() returns. Swapped per-test by pointing
// at the local servers' ephemeral ports.
let parallelBaseUrl = "https://api.parallel.ai";

vi.mock("@/lib/server/env", () => ({
  env: () => ({ PARALLEL_BASE_URL: parallelBaseUrl }),
}));

interface LocalServer {
  url: string;
  close: () => Promise<void>;
}

async function startServer(handler: http.RequestListener): Promise<LocalServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

d("E2E: testParallelKey (real fetch, local server)", () => {
  let hungServer: LocalServer;
  let badStatusServer: LocalServer;
  let okServer: LocalServer;

  beforeAll(async () => {
    hungServer = await startServer(() => {
      /* never responds — proves the SDK's 5s timeout fires */
    });

    badStatusServer = await startServer((_req, res) => {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "synthetic server error from e2e test" }));
    });

    okServer = await startServer((req, res) => {
      if (req.url?.startsWith("/v1/monitors")) {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [], has_more: false }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });

  afterAll(async () => {
    await Promise.allSettled([
      hungServer?.close(),
      badStatusServer?.close(),
      okServer?.close(),
    ]);
  });

  it("returns ok:true against a 200-emulating local Parallel API", async () => {
    parallelBaseUrl = okServer.url;
    vi.resetModules();
    const { testParallelKey } = await import("@/lib/server/providers");
    const start = Date.now();
    const r = await testParallelKey("pk-anything");
    const elapsed = Date.now() - start;
    expect(r.ok, `unexpected error: ${r.error}`).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("surfaces 500 + body when the Parallel API errors out", async () => {
    parallelBaseUrl = badStatusServer.url;
    vi.resetModules();
    const { testParallelKey } = await import("@/lib/server/providers");
    const r = await testParallelKey("pk-anything");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("500");
    expect(r.error).not.toContain("undefined");
  });

  it("times out within ~5s against a hung Parallel region", async () => {
    parallelBaseUrl = hungServer.url;
    vi.resetModules();
    const { testParallelKey } = await import("@/lib/server/providers");
    const start = Date.now();
    const r = await testParallelKey("pk-anything");
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/i);
    expect(r.error).not.toMatch(/undefined/);
    // Between 4.5s and 6.5s proves the SDK's 5s timeout controls the
    // round-trip, not Vitest's default 5s test timeout or a fluke.
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(6_500);
  }, 15_000);

  (REAL_NETWORK ? it : it.skip)(
    "real api.parallel.ai rejects a bogus key",
    async () => {
      parallelBaseUrl = "https://api.parallel.ai";
      vi.resetModules();
      const { testParallelKey } = await import("@/lib/server/providers");
      const r = await testParallelKey("pk-this-is-not-a-real-key-1234567890");
      expect(r.ok).toBe(false);
      expect(r.error).not.toMatch(/undefined/);
    },
    15_000,
  );
});

d("E2E: testSlackToken / testResendKey timeout helpers", () => {
  // Slack and Resend URLs are hardcoded, so we can't redirect them to a
  // local server. Patch globalThis.fetch with a real Promise that respects
  // the AbortSignal — same shape as a genuinely-hung region.
  function installHangingFetch(): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          },
          { once: true },
        );
      })) as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  it("Slack token test times out within ~5s when the upstream hangs", async () => {
    const restore = installHangingFetch();
    try {
      vi.resetModules();
      const { testSlackToken } = await import("@/lib/server/providers");
      const start = Date.now();
      const r = await testSlackToken("xoxb-fake-but-correctly-prefixed");
      const elapsed = Date.now() - start;
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/timed out/i);
      expect(elapsed).toBeGreaterThanOrEqual(4_500);
      expect(elapsed).toBeLessThan(6_500);
    } finally {
      restore();
    }
  }, 15_000);

  it("Resend key test times out within ~5s when the upstream hangs", async () => {
    const restore = installHangingFetch();
    try {
      vi.resetModules();
      const { testResendKey } = await import("@/lib/server/providers");
      const start = Date.now();
      const r = await testResendKey("re_fake-but-correctly-prefixed");
      const elapsed = Date.now() - start;
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/timed out/i);
      expect(elapsed).toBeGreaterThanOrEqual(4_500);
      expect(elapsed).toBeLessThan(6_500);
    } finally {
      restore();
    }
  }, 15_000);

  (REAL_NETWORK ? it : it.skip)(
    "real slack.com auth.test rejects a bogus bot token",
    async () => {
      vi.resetModules();
      const { testSlackToken } = await import("@/lib/server/providers");
      const r = await testSlackToken("xoxb-0000-not-a-real-token");
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/slack:/);
    },
    15_000,
  );

  (REAL_NETWORK ? it : it.skip)(
    "real api.resend.com rejects a bogus key",
    async () => {
      vi.resetModules();
      const { testResendKey } = await import("@/lib/server/providers");
      const r = await testResendKey("re_thisisnotrealnotreal_0000000000");
      expect(r.ok).toBe(false);
      // Resend returns either 401 (key rejected) or 400 ("API key is
      // invalid") depending on the exact shape of the bogus key. Both
      // are valid rejections — the important thing is we never emit
      // "undefined" or a hang.
      expect(r.error).toMatch(/40[01]|rejected|invalid/i);
      expect(r.error).not.toMatch(/undefined/);
    },
    15_000,
  );
});

// Tiny meta-test so the default (no env var) run doesn't show as "0 tests"
// for this file in vitest output — useful as a signal that the gating
// actually worked.
describe("providers e2e gating", () => {
  it("reports whether E2E mode is enabled", () => {
    if (E2E_ENABLED) {
      expect(E2E_ENABLED).toBe(true);
    } else {
      expect(E2E_ENABLED).toBe(false);
    }
  });
});
