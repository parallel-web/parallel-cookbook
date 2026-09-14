import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./worker";

vi.mock("./index.html", () => ({ default: "<h1>Fact checker</h1>" }));

const claim = "Paris is the capital of France.";
const env = { PARALLEL_API_KEY: "test-key", CEREBRAS_API_KEY: "test-key" };
const requests: Array<{ url: string; body: any }> = [];
let inference: Array<() => Response>;
let searchStatus: number;

function textResponse(text: string): Response {
  const chunks = [
    { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function apiError(status: number): Response {
  return Response.json({ error: { message: "Private provider diagnostic", type: "api_error" } }, { status });
}

async function events(path: string, body: object): Promise<any[]> {
  const response = await worker.fetch(new Request(`https://demo.example${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), env, {} as ExecutionContext);
  expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  const text = await response.text();
  expect(text).toContain("data: [DONE]");
  expect(text).not.toContain("Private provider diagnostic");
  return text.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
}

beforeEach(() => {
  requests.length = 0;
  searchStatus = 200;
  inference = [
    () => textResponse(`FACT: ${claim} ||| ${claim}`),
    () => textResponse("VERDICT: VERIFIED\nEXPLANATION: Sources confirm the claim."),
  ];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const request = new Request(input, init);
    const body = await request.json();
    requests.push({ url: request.url, body });
    const path = new URL(request.url).pathname;
    if (request.url.startsWith("https://api.cerebras.ai/") && path === "/v1/chat/completions") {
      const next = inference.shift();
      if (!next) throw new Error("Unexpected inference request");
      return next();
    }
    if (request.url === "https://api.parallel.ai/v1/search") {
      if (searchStatus !== 200) return apiError(searchStatus);
      return Response.json({ search_id: "test-search", results: [{
        title: "Reference", url: "https://example.com/reference", excerpts: [claim],
      }] });
    }
    if (request.url === "https://api.parallel.ai/v1/extract") {
      return Response.json({ extract_id: "test-extract", errors: [], results: [{
        title: "Article", url: body.urls[0], excerpts: [claim],
      }] });
    }
    throw new Error(`Unexpected network request: ${request.url}`);
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fact checker with the real provider SDKs", () => {
  it.each(["/check", "/agents/cerebras-fact-checker/check"])("checks pasted text through %s", async path => {
    const result = await events(path, { content: claim });
    expect(result.find(event => event.type === "fact_verdict")).toMatchObject({
      status: "verified", explanation: "Sources confirm the claim.",
      references: [{ title: "Reference", url: "https://example.com/reference", excerpt: claim }],
    });
    expect(requests.find(request => request.url.endsWith("/search"))?.body).toMatchObject({
      mode: "basic", advanced_settings: { max_results: 5, excerpt_settings: { max_chars_per_result: 2000 } },
    });
  });

  it("extracts a URL and completes the same verification flow", async () => {
    const result = await events("/agents/cerebras-fact-checker/extract", { url: "https://example.com/article" });
    expect(result.find(event => event.type === "content_complete")).toMatchObject({ content: claim });
    expect(result.find(event => event.type === "fact_verdict")?.status).toBe("verified");
    expect(requests[0].body).toMatchObject({ advanced_settings: { full_content: false } });
  });

  it.each(["/check", "/extract"])("surfaces inference authentication failure on %s", async path => {
    inference = [() => apiError(401)];
    const result = await events(path, { content: claim, url: "https://example.com/article" });
    expect(result.find(event => event.type === "error")?.error).toContain("cannot access an upstream service");
    expect(result.some(event => event.type === "fact_verdict")).toBe(false);
    expect(requests.some(request => request.url.endsWith("/search"))).toBe(false);
  });

  it("distinguishes content without claims from failed inference", async () => {
    inference = [() => textResponse("No verifiable claims.")];
    const result = await events("/check", { content: "I like this color." });
    expect(result.find(event => event.type === "error")?.error).toBe("No verifiable claims were found in the content.");
  });

  it("reports a failed verdict request explicitly", async () => {
    inference[1] = () => apiError(403);
    const result = await events("/check", { content: claim });
    expect(result.find(event => event.type === "fact_verdict")).toMatchObject({
      status: "unsure", explanation: expect.stringContaining("cannot access an upstream service"), references: [],
    });
  });

  it("does not accept a truncated verdict as a verified claim", async () => {
    inference[1] = () => textResponse("VERDICT: VERIFIED");
    const result = await events("/check", { content: claim });
    expect(result.find(event => event.type === "fact_verdict")).toMatchObject({
      status: "unsure", explanation: expect.stringContaining("incomplete verdict"), references: [],
    });
  });

  it("reports exhausted search credits without exposing provider details", async () => {
    searchStatus = 402;
    const result = await events("/check", { content: claim });
    expect(result.find(event => event.type === "fact_verdict")).toMatchObject({
      status: "unsure", explanation: expect.stringContaining("credits are unavailable"), references: [],
    });
  });
});
