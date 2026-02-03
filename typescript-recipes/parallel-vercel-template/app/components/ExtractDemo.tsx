"use client";

import { useState } from "react";
import { useSessionStorage } from "@/hooks/useSessionStorage";

interface ExtractResult {
  url: string;
  title?: string;
  excerpts?: string[];
  full_content?: string;
}

interface ExtractResponse {
  results: ExtractResult[];
  error?: string;
}

interface StoredExtractState {
  urls: string;
  objective: string;
  results: ExtractResult[];
  error: string | null;
}

const INITIAL_STATE: StoredExtractState = {
  urls: "",
  objective: "",
  results: [],
  error: null,
};

export default function ExtractDemo() {
  const [storedState, setStoredState, clearStoredState, isHydrated] =
    useSessionStorage<StoredExtractState>("parallel-extract-demo", INITIAL_STATE);

  const [loading, setLoading] = useState(false);

  const { urls, objective, results, error } = storedState;

  const setUrls = (value: string) =>
    setStoredState((prev) => ({ ...prev, urls: value }));
  const setObjective = (value: string) =>
    setStoredState((prev) => ({ ...prev, objective: value }));
  const setResults = (value: ExtractResult[]) =>
    setStoredState((prev) => ({ ...prev, results: value }));
  const setError = (value: string | null) =>
    setStoredState((prev) => ({ ...prev, error: value }));

  const handleExtract = async () => {
    const urlList = urls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);

    if (urlList.length === 0) return;

    // Clear previous results when starting a new extraction
    setStoredState((prev) => ({ ...prev, results: [], error: null }));
    setLoading(true);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: urlList,
          objective: objective.trim() || undefined,
        }),
      });

      const data: ExtractResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Extract failed");
      }

      setResults(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    clearStoredState();
  };

  // Don't render content until hydrated to avoid hydration mismatch
  if (!isHydrated) {
    return <div className="space-y-6" />;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor="urls"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              URLs to Extract (one per line)
            </label>
            <a
              href="https://docs.parallel.ai/api-reference/extract-beta/extract"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-green-600 dark:text-green-400 hover:underline"
            >
              API Docs
            </a>
          </div>
          <textarea
            id="urls"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder="https://example.com/article&#10;https://another-site.com/page"
            className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none font-mono text-sm"
            rows={3}
          />
        </div>

        <div>
          <label
            htmlFor="extract-objective"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
          >
            Extraction Objective (optional)
          </label>
          <input
            id="extract-objective"
            type="text"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="What information are you looking for?"
            className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Providing an objective focuses the extraction on relevant content
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleExtract}
            disabled={loading || !urls.trim()}
            className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-zinc-400 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            {loading ? "Extracting..." : "Extract Content"}
          </button>
          {(results.length > 0 || urls || objective) && (
            <button
              onClick={handleClear}
              className="py-3 px-4 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Extracted Content ({results.length})
          </h3>
          {results.map((result, index) => (
            <div
              key={index}
              className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {result.title && (
                    <h4 className="font-medium text-zinc-900 dark:text-zinc-100">
                      {result.title}
                    </h4>
                  )}
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-green-600 dark:text-green-400 hover:underline truncate block"
                  >
                    {result.url}
                  </a>
                </div>
              </div>

              {result.excerpts && result.excerpts.length > 0 && (
                <div className="mt-4 space-y-3">
                  <h5 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Excerpts:
                  </h5>
                  {result.excerpts.map((excerpt, i) => (
                    <div
                      key={i}
                      className="text-sm text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-3 rounded border-l-2 border-green-400 whitespace-pre-wrap"
                    >
                      {excerpt}
                    </div>
                  ))}
                </div>
              )}

              {result.full_content && (
                <div className="mt-4">
                  <h5 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Full Content:
                  </h5>
                  <div className="text-sm text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-3 rounded max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {result.full_content}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
