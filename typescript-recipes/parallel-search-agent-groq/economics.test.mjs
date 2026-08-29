import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInThisContext } from "node:vm";

import ts from "typescript";

const require = createRequire(import.meta.url);

// Load the actual Worker and SDKs without changing the package's module mode
// or depending on Node's version-specific TypeScript support.
function loadTypeScript(url) {
  const { outputText } = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  runInThisContext(`(function(require, module, exports) { ${outputText}\n})`, {
    filename: url.pathname,
  })(
    (id) => {
      if (id.endsWith(".html")) return readFileSync(new URL(id, url), "utf8");
      if (id.startsWith("./")) return loadTypeScript(new URL(`${id}.ts`, url));
      return require(id);
    },
    module,
    module.exports
  );
  return module.exports;
}

const { createEconomicsTracker, readEconomicsConfig } = loadTypeScript(
  new URL("./economics.ts", import.meta.url)
);
const worker = loadTypeScript(new URL("./worker.ts", import.meta.url)).default;

test("GA search modes use their documented, overridable pricing assumptions", () => {
  for (const [mode, price] of [
    ["turbo", 1],
    ["fast", 1],
    ["basic", 5],
    ["advanced", 5],
  ]) {
    assert.equal(
      readEconomicsConfig({ PARALLEL_SEARCH_MODE: mode }).searchUsdPer1k,
      price
    );
  }

  const overridden = readEconomicsConfig({
    PARALLEL_SEARCH_USD_PER_1K: "2.25",
    MODEL_INPUT_USD_PER_1M: "0",
    MODEL_OUTPUT_USD_PER_1M: "1.50",
  });

  assert.deepEqual(overridden, {
    searchMode: "basic",
    searchUsdPer1k: 2.25,
    modelInputUsdPer1m: 0,
    modelOutputUsdPer1m: 1.5,
  });
});

test("invalid modes and pricing fail without silently misreporting costs", () => {
  assert.throws(
    () => readEconomicsConfig({ PARALLEL_SEARCH_MODE: "one-shot" }),
    /PARALLEL_SEARCH_MODE/
  );

  for (const invalidPrice of ["-1", "NaN", "Infinity"]) {
    assert.throws(
      () =>
        readEconomicsConfig({ PARALLEL_SEARCH_USD_PER_1K: invalidPrice }),
      /non-negative, finite number/
    );
  }
});

test("reports measured retrieval, provider token usage, and configured costs", () => {
  let now = 1_000;
  const tracker = createEconomicsTracker(
    readEconomicsConfig({
      PARALLEL_SEARCH_MODE: "turbo",
      MODEL_INPUT_USD_PER_1M: "2",
      MODEL_OUTPUT_USD_PER_1M: "8",
    }),
    () => now
  );
  const firstSearch = {
    search_id: "fixture-search-1",
    results: [
      { url: "https://example.com/one", excerpts: ["hello", "🌍"] },
      { url: "https://example.com/two", excerpts: [] },
    ],
  };
  const secondSearch = {
    search_id: "fixture-search-2",
    results: [{ url: "https://example.com/three", excerpts: ["context"] }],
  };

  tracker.recordSearch(firstSearch, 120.4);
  tracker.recordSearch(secondSearch, 79.6);
  tracker.recordModelUsage({
    inputTokens: 1_200,
    outputTokens: 300,
    totalTokens: 1_500,
  });
  now = 1_450;

  assert.deepEqual(
    tracker.summarize(),
    {
      search: {
        mode: "turbo",
        calls: 2,
        sources: 3,
        excerpts: 3,
        excerptCharacters: 13,
        serializedResultBytes:
          new TextEncoder().encode(JSON.stringify(firstSearch)).length +
          new TextEncoder().encode(JSON.stringify(secondSearch)).length,
        latenciesMs: [120, 80],
        totalLatencyMs: 200,
        assumedUsdPer1k: 1,
        estimatedCostUsd: 0.002,
      },
      inference: {
        inputTokens: 1_200,
        outputTokens: 300,
        totalTokens: 1_500,
        assumedInputUsdPer1m: 2,
        assumedOutputUsdPer1m: 8,
        estimatedCostUsd: 0.0048,
      },
      workflow: {
        elapsedMs: 450,
        estimatedTotalCostUsd: 0.0068,
      },
    }
  );
});

test("leaves unavailable usage and model pricing explicitly unavailable", () => {
  const tracker = createEconomicsTracker(readEconomicsConfig({}), () => 25);
  tracker.recordSearch({ results: [{ excerpts: null }] }, 0);

  assert.deepEqual(tracker.summarize(), {
    search: {
      mode: "basic",
      calls: 1,
      sources: 1,
      excerpts: 0,
      excerptCharacters: 0,
      serializedResultBytes: new TextEncoder().encode(
        JSON.stringify({ results: [{ excerpts: null }] })
      ).length,
      latenciesMs: [0],
      totalLatencyMs: 0,
      assumedUsdPer1k: 5,
      estimatedCostUsd: 0.005,
    },
    inference: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      assumedInputUsdPer1m: null,
      assumedOutputUsdPer1m: null,
      estimatedCostUsd: null,
    },
    workflow: {
      elapsedMs: 0,
      estimatedTotalCostUsd: null,
    },
  });
});

test("rejects impossible search timings and unavailable provider token counts", () => {
  const tracker = createEconomicsTracker(
    readEconomicsConfig({
      MODEL_INPUT_USD_PER_1M: "1",
      MODEL_OUTPUT_USD_PER_1M: "1",
    }),
    () => 0
  );

  assert.throws(
    () => tracker.recordSearch({ results: [] }, -1),
    /Search latency/
  );

  tracker.recordModelUsage({
    inputTokens: -1,
    outputTokens: 10,
    totalTokens: Number.NaN,
  });
  const result = tracker.summarize();

  assert.equal(result.inference.inputTokens, null);
  assert.equal(result.inference.totalTokens, null);
  assert.equal(result.inference.estimatedCostUsd, null);
});

test("missing counts stay unavailable across steps without discarding known counts", () => {
  for (const missingKey of ["inputTokens", "outputTokens", "totalTokens"]) {
    for (const missingFirst of [true, false]) {
      const tracker = createEconomicsTracker(readEconomicsConfig({}));
      const complete = { inputTokens: 10, outputTokens: 0, totalTokens: 10 };
      const partial = { ...complete, [missingKey]: undefined };
      for (const usage of missingFirst ? [partial, complete] : [complete, partial]) {
        tracker.recordModelUsage(usage);
      }
      const { inference } = tracker.summarize();
      for (const key of Object.keys(complete)) {
        assert.equal(inference[key], key === missingKey ? null : complete[key] * 2);
      }
    }
  }
});

test("Worker streams real SDK tool calls and only estimates complete model usage", async (t) => {
  const usage = { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 };
  for (const scenario of [
    { name: "complete usage", usages: [usage, usage], known: true },
    { name: "first step missing", usages: [undefined, usage], known: false },
    { name: "last step missing", usages: [usage, undefined], known: false },
    { name: "Search failure", usages: [usage, usage], known: true, searchFails: true },
  ]) {
    await t.test(scenario.name, async (t) => {
      let modelCalls = 0;
      const searchRequests = [];
      t.mock.method(globalThis, "fetch", async (url, options) => {
        const target = String(url);
        if (target === "https://api.parallel.ai/v1/search") {
          searchRequests.push(JSON.parse(options.body));
          return Response.json(
            scenario.searchFails
              ? { error: "Fixture Search failure" }
              : { search_id: "fixture", session_id: "fixture", results: [
                  { url: "https://example.com", title: "Fixture", excerpts: ["hello 🌍"] },
                ] },
            { status: scenario.searchFails ? 400 : 200 }
          );
        }
        assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
        assert.ok(modelCalls < 2, "Unexpected extra model request");
        const first = modelCalls === 0;
        const stepUsage = scenario.usages[modelCalls++];
        const chunk = {
          id: "fixture",
          choices: [{
            index: 0,
            delta: first
              ? { tool_calls: [{
                  index: 0, id: "fixture-search", type: "function",
                  function: { name: "search", arguments: JSON.stringify({ objective: "Parallel Search" }) },
                }] }
              : { content: "Fixture answer" },
            finish_reason: first ? "tool_calls" : "stop",
          }],
          ...(stepUsage ? { x_groq: { usage: stepUsage } } : {}),
        };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        });
      });
      const response = await worker.fetch(
        new Request("http://localhost/", {
          method: "POST", body: JSON.stringify({ query: "fixture" }),
        }),
        {
          PARALLEL_API_KEY: "fixture", GROQ_API_KEY: "fixture",
          PARALLEL_SEARCH_MODE: "turbo",
          MODEL_INPUT_USD_PER_1M: "2", MODEL_OUTPUT_USD_PER_1M: "8",
          RATE_LIMIT_KV: { get: async () => null, put: async () => {} },
        },
        {}
      );
      assert.equal(response.headers.get("Content-Type"), "text/event-stream");
      const stream = await response.text();
      assert.ok(stream.endsWith("data: [DONE]\n\n"));
      const events = stream.split("\n\n").filter((line) => line && line !== "data: [DONE]")
        .map((line) => JSON.parse(line.slice(6)));
      assert.equal(modelCalls, 2);
      assert.deepEqual(searchRequests, [{
        objective: "Parallel Search", search_queries: ["Parallel Search"], mode: "turbo",
        max_chars_total: 25_000,
        advanced_settings: { max_results: 10, excerpt_settings: { max_chars_per_result: 2_500 } },
      }]);
      assert.ok(events.some((event) => event.type === (scenario.searchFails ? "tool-error" : "tool-result")));
      assert.equal(events.find((event) => event.type === "text-delta").text, "Fixture answer");
      const { economics } = events.find((event) => event.type === "finish");
      assert.equal(economics.search.calls, scenario.searchFails ? 0 : 1);
      assert.equal(economics.search.excerptCharacters, scenario.searchFails ? 0 : 7);
      assert.equal(economics.inference.inputTokens, scenario.known ? 400 : null);
      assert.equal(economics.inference.outputTokens, scenario.known ? 40 : null);
      assert.equal(economics.inference.totalTokens, scenario.known ? 440 : null);
      assert.equal(economics.inference.estimatedCostUsd, scenario.known ? 0.00112 : null);
      assert.equal(economics.workflow.estimatedTotalCostUsd,
        scenario.known ? (scenario.searchFails ? 0.00112 : 0.00212) : null);
    });
  }
});
