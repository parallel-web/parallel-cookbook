export type SearchMode = "turbo" | "fast" | "basic" | "advanced";

const DEFAULT_SEARCH_PRICES_USD_PER_1K: Record<SearchMode, number> = {
  turbo: 1,
  fast: 1,
  basic: 5,
  advanced: 5,
};

interface EconomicsEnvironment {
  PARALLEL_SEARCH_MODE?: string;
  PARALLEL_SEARCH_USD_PER_1K?: string;
  MODEL_INPUT_USD_PER_1M?: string;
  MODEL_OUTPUT_USD_PER_1M?: string;
}

export interface EconomicsConfig {
  searchMode: SearchMode;
  searchUsdPer1k: number;
  modelInputUsdPer1m: number | null;
  modelOutputUsdPer1m: number | null;
}

interface SearchResult {
  results: Array<{ excerpts?: string[] | null }>;
}

interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

function readOptionalPrice(value: string | undefined, name: string) {
  if (value === undefined || value.trim() === "") return null;

  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`${name} must be a non-negative, finite number`);
  }

  return price;
}

function roundUsd(amount: number) {
  return Math.round(amount * 1_000_000_000) / 1_000_000_000;
}

function readTokenCount(count: number | undefined) {
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? count
    : null;
}

export function readEconomicsConfig(env: EconomicsEnvironment): EconomicsConfig {
  const searchMode = env.PARALLEL_SEARCH_MODE?.trim() || "basic";
  if (!Object.hasOwn(DEFAULT_SEARCH_PRICES_USD_PER_1K, searchMode)) {
    throw new Error(
      "PARALLEL_SEARCH_MODE must be turbo, fast, basic, or advanced"
    );
  }

  const mode = searchMode as SearchMode;

  return {
    searchMode: mode,
    searchUsdPer1k:
      readOptionalPrice(
        env.PARALLEL_SEARCH_USD_PER_1K,
        "PARALLEL_SEARCH_USD_PER_1K"
      ) ?? DEFAULT_SEARCH_PRICES_USD_PER_1K[mode],
    modelInputUsdPer1m: readOptionalPrice(
      env.MODEL_INPUT_USD_PER_1M,
      "MODEL_INPUT_USD_PER_1M"
    ),
    modelOutputUsdPer1m: readOptionalPrice(
      env.MODEL_OUTPUT_USD_PER_1M,
      "MODEL_OUTPUT_USD_PER_1M"
    ),
  };
}

/** Tracks observed retrieval and provider-reported inference without estimating tokens. */
export function createEconomicsTracker(
  config: EconomicsConfig,
  now: () => number = () => performance.now()
) {
  const startedAt = now();
  const encoder = new TextEncoder();
  const searchLatenciesMs: number[] = [];
  let sourceCount = 0;
  let excerptCount = 0;
  let excerptCharacters = 0;
  let serializedResultBytes = 0;

  return {
    recordSearch(searchResult: SearchResult, elapsedMs: number) {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        throw new Error("Search latency must be a non-negative, finite number");
      }

      searchLatenciesMs.push(Math.round(elapsedMs));
      sourceCount += searchResult.results.length;
      serializedResultBytes += encoder.encode(
        JSON.stringify(searchResult)
      ).length;

      for (const result of searchResult.results) {
        for (const excerpt of result.excerpts ?? []) {
          excerptCount += 1;
          excerptCharacters += Array.from(excerpt).length;
        }
      }
    },

    summarize(usage?: ModelUsage) {
      const inputTokens = readTokenCount(usage?.inputTokens);
      const outputTokens = readTokenCount(usage?.outputTokens);
      const totalTokens = readTokenCount(usage?.totalTokens);
      const searchCostUsd = roundUsd(
        (searchLatenciesMs.length * config.searchUsdPer1k) / 1_000
      );
      const modelCostUsd =
        inputTokens !== null &&
        outputTokens !== null &&
        config.modelInputUsdPer1m !== null &&
        config.modelOutputUsdPer1m !== null
          ? roundUsd(
              (inputTokens * config.modelInputUsdPer1m +
                outputTokens * config.modelOutputUsdPer1m) /
                1_000_000
            )
          : null;

      return {
        search: {
          mode: config.searchMode,
          calls: searchLatenciesMs.length,
          sources: sourceCount,
          excerpts: excerptCount,
          excerptCharacters,
          serializedResultBytes,
          latenciesMs: [...searchLatenciesMs],
          totalLatencyMs: searchLatenciesMs.reduce(
            (total, latency) => total + latency,
            0
          ),
          assumedUsdPer1k: config.searchUsdPer1k,
          estimatedCostUsd: searchCostUsd,
        },
        inference: {
          inputTokens,
          outputTokens,
          totalTokens,
          assumedInputUsdPer1m: config.modelInputUsdPer1m,
          assumedOutputUsdPer1m: config.modelOutputUsdPer1m,
          estimatedCostUsd: modelCostUsd,
        },
        workflow: {
          elapsedMs: Math.max(0, Math.round(now() - startedAt)),
          estimatedTotalCostUsd:
            modelCostUsd === null ? null : roundUsd(searchCostUsd + modelCostUsd),
        },
      };
    },
  };
}
