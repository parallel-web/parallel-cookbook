"use client";

import { useState } from "react";

interface SearchResult {
  title: string;
  url: string;
  excerpts?: string[];
}

interface SearchResponse {
  results: SearchResult[];
  error?: string;
}

export default function SearchDemo() {
  const [objective, setObjective] = useState("");
  const [searchQueries, setSearchQueries] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!objective.trim()) return;

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective: objective.trim(),
          searchQueries: searchQueries
            .split(",")
            .map((q) => q.trim())
            .filter(Boolean),
          maxResults: 10,
        }),
      });

      const data: SearchResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }

      setResults(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label
            htmlFor="objective"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
          >
            Search Objective
          </label>
          <textarea
            id="objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Describe what you're looking for... (e.g., 'Find recent news about AI safety research')"
            className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={3}
          />
        </div>

        <div>
          <label
            htmlFor="queries"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
          >
            Search Queries (optional, comma-separated)
          </label>
          <input
            id="queries"
            type="text"
            value={searchQueries}
            onChange={(e) => setSearchQueries(e.target.value)}
            placeholder="AI safety, machine learning alignment"
            className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          onClick={handleSearch}
          disabled={loading || !objective.trim()}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Results ({results.length})
          </h3>
          {results.map((result, index) => (
            <div
              key={index}
              className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800"
            >
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium text-lg"
              >
                {result.title}
              </a>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                {result.url}
              </p>
              {result.excerpts && result.excerpts.length > 0 && (
                <div className="mt-3 space-y-2">
                  {result.excerpts.slice(0, 2).map((excerpt, i) => (
                    <p
                      key={i}
                      className="text-sm text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-3 rounded border-l-2 border-blue-400"
                    >
                      {excerpt.length > 300
                        ? excerpt.slice(0, 300) + "..."
                        : excerpt}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && results.length === 0 && !error && objective && (
        <p className="text-center text-zinc-500 dark:text-zinc-400">
          No results found. Try a different search objective.
        </p>
      )}
    </div>
  );
}
