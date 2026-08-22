import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("./economics.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext } }
);
const { createEconomicsTracker, readEconomicsConfig } = await import(
  `data:text/javascript,${encodeURIComponent(outputText)}`
);

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
  now = 1_450;

  assert.deepEqual(
    tracker.summarize({
      inputTokens: 1_200,
      outputTokens: 300,
      totalTokens: 1_500,
    }),
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

  const result = tracker.summarize({
    inputTokens: -1,
    outputTokens: 10,
    totalTokens: Number.NaN,
  });

  assert.equal(result.inference.inputTokens, null);
  assert.equal(result.inference.totalTokens, null);
  assert.equal(result.inference.estimatedCostUsd, null);
});
