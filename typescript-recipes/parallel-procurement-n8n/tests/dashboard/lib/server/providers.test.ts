/**
 * testParallelKey tests (finding 16 + review #1/#2):
 *  - Empty / whitespace-only input → "Key is empty"
 *  - 200 from V1 monitor.list → ok:true with the V1 detail string
 *  - 401/403 → "Parallel rejected this key"
 *  - 5xx with body.error → status + truncated message bubble up
 *  - Network failure (fetch rejects with non-abort error) → message surfaced
 *  - Timeout / abort (fetch rejects with AbortError) → friendly timeout copy,
 *    NOT the generic "Parallel returned undefined: " string
 *
 * We hit the real parallel-web SDK and stub global fetch, so the test
 * verifies the actual code path (including that we're hitting /v1/monitors,
 * not /v1beta/...). The SDK reads `globalThis.fetch` lazily inside the
 * `Parallel` constructor (via Shims.getDefaultFetch()), so swapping it via
 * `vi.stubGlobal("fetch", ...)` BEFORE `await import(...)` is sufficient. If
 * a future SDK upgrade captures fetch at module load instead, these tests
 * will go silent rather than fail — keep an eye on parallel-web changelogs
 * when bumping the dep.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/server/env", () => ({
  env: () => ({ PARALLEL_BASE_URL: "https://api.parallel.example" }),
}));

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);

beforeEach(() => {
  // Reset BEFORE each test so we don't pick up state left by a sibling test
  // file in the workspace runner (review #5). `resetModules` ensures the
  // dynamic `import("@/lib/server/providers")` below re-evaluates against
  // the freshly-reset mocks.
  fetchSpy.mockReset();
  vi.resetModules();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build a fetch mock that respects the caller's AbortSignal: it stays
 * pending until the signal fires, then rejects with a spec-compliant
 * AbortError. The SDK's internal `isAbortError` helper promotes this into
 * `APIConnectionTimeoutError`; our `timedFetch` helper sees it directly.
 * If the call site forgets to thread a signal through, we fail-fast rather
 * than hang the worker.
 */
function abortAwareFetch() {
  return (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("expected fetch init.signal but got none"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        },
        { once: true },
      );
    });
}

describe("testParallelKey", () => {
  it("returns ok:false for an empty key (no fetch issued)", async () => {
    const { testParallelKey } = await import("@/lib/server/providers");
    const r = await testParallelKey("");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("empty");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns ok:false for a whitespace-only key (trim path)", async () => {
    const { testParallelKey } = await import("@/lib/server/providers");
    const r = await testParallelKey("   \t\n");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("empty");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("hits the V1 monitors endpoint (NOT v1beta) when the key is valid", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { data: [], has_more: false }));

    const { testParallelKey } = await import("@/lib/server/providers");
    const r = await testParallelKey("pk-valid");

    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/V1/);
    // The whole point of finding 16: assert that the request goes to /v1/...
    // not /v1beta/tasks/groups.
    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string | URL | undefined;
    const urlStr = calledUrl instanceof URL ? calledUrl.toString() : String(calledUrl ?? "");
    expect(urlStr).toContain("/v1/");
    expect(urlStr).not.toContain("/v1beta/");
  });

  it("returns 'rejected' message on 401", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { error: "Unauthorized" }));
    const { testParallelKey } = await import("@/lib/server/providers");
    const r = await testParallelKey("pk-bad");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rejected/);
    expect(r.error).toContain("401");
  });

  it("returns 'rejected' message on 403", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(403, { error: "Forbidden" }));
    const { testParallelKey } = await import("@/lib/server/providers");
    const r = await testParallelKey("pk-bad");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rejected/);
    expect(r.error).toContain("403");
  });

  it("surfaces status + truncated body message on 500", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(500, { error: "Server exploded with reason XYZ" }),
    );
    const { testParallelKey } = await import("@/lib/server/providers");
    const r = await testParallelKey("pk-anything");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("500");
    // The Stainless-generated APIError builds a message from the body, so
    // we shouldn't see the literal "undefined" placeholder that the old
    // error-handling order produced for abort/timeout errors.
    expect(r.error).not.toContain("undefined");
  });

  it("surfaces a friendly timeout message when the SDK aborts (NOT 'undefined')", async () => {
    // The SDK installs an internal AbortController in fetchWithTimeout and
    // wires it into `init.signal`. Reject when it aborts; the SDK promotes
    // this into `APIConnectionTimeoutError`, which our handler maps to a
    // user-visible "timed out" string instead of the generic
    // "Parallel returned undefined: " bug from before review #1.
    fetchSpy.mockImplementationOnce(abortAwareFetch());

    const { testParallelKey } = await import("@/lib/server/providers");
    const r = await testParallelKey("pk-slow");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/i);
    expect(r.error).not.toMatch(/undefined/);
  }, 10_000); // give the SDK's 5s timeout headroom

  it("surfaces a connection-failure message when fetch rejects with a non-abort error", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
    const { testParallelKey } = await import("@/lib/server/providers");
    const r = await testParallelKey("pk-anything");
    expect(r.ok).toBe(false);
    // SDK wraps non-abort fetch rejections in APIConnectionError; our
    // handler turns that into "Parallel connection failed: ...".
    expect(r.error).toMatch(/connection failed/i);
  });
});

describe("testSlackToken", () => {
  it("rejects tokens with the wrong prefix without issuing a fetch", async () => {
    const { testSlackToken } = await import("@/lib/server/providers");
    const r = await testSlackToken("nope-not-a-real-token");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/xoxb-/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a friendly timeout message when Slack hangs", async () => {
    fetchSpy.mockImplementationOnce(abortAwareFetch());

    const { testSlackToken } = await import("@/lib/server/providers");
    const r = await testSlackToken("xoxb-fake");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/i);
  }, 10_000);
});

describe("testResendKey", () => {
  it("rejects keys without the re_ prefix without issuing a fetch", async () => {
    const { testResendKey } = await import("@/lib/server/providers");
    const r = await testResendKey("sk-not-resend");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/re_/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a friendly timeout message when Resend hangs", async () => {
    fetchSpy.mockImplementationOnce(abortAwareFetch());

    const { testResendKey } = await import("@/lib/server/providers");
    const r = await testResendKey("re_fake");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/i);
  }, 10_000);
});
