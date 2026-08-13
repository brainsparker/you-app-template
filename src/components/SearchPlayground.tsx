"use client";

import { useRef, useState } from "react";
import { useApiKey } from "@/lib/api-key";
import {
  extractSearchResults,
  resultSnippet,
  search,
  YouApiError,
  type YouSearchResult,
} from "@/lib/you-client";

/**
 * Minimal live demo proving the BYOK + proxy pipeline end to end:
 * browser -> /api/you/v1/search (edge) -> api.you.com -> results.
 */
export function SearchPlayground() {
  const { apiKey, clearApiKey } = useApiKey();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    const q = query.trim();
    if (!q || !apiKey) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResults(null);
    setLatencyMs(null);

    const started = performance.now();
    try {
      const data = await search(apiKey, { query: q }, controller.signal);
      setLatencyMs(Math.round(performance.now() - started));
      setResults(extractSearchResults(data));
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof YouApiError && err.status === 401) {
        setError(
          "That key was rejected (401). Remove it and paste a valid You.com API key.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Request failed.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Live search playground
        </h3>
        <code className="rounded bg-surface px-2 py-1 text-xs text-muted">
          POST /v1/search
        </code>
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input
          className="input flex-1"
          placeholder="Search the live web, e.g. latest developments in AI search APIs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          className="btn-primary shrink-0"
          disabled={loading || !query.trim()}
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">
          {error}{" "}
          {error.includes("401") && (
            <button
              type="button"
              onClick={clearApiKey}
              className="underline transition hover:text-red-100"
            >
              Remove saved key
            </button>
          )}
        </div>
      )}

      {latencyMs !== null && results && (
        <p className="mt-4 text-xs text-muted">
          {results.length} results in {latencyMs} ms, straight from the live
          web.
        </p>
      )}

      {results && results.length > 0 && (
        <ol className="mt-3 space-y-4">
          {results.map((r, i) => {
            const title =
              (typeof r.title === "string" && r.title) ||
              (typeof r.name === "string" && r.name) ||
              r.url;
            const snippet = resultSnippet(r);
            return (
              <li key={`${r.url}-${i}`} className="border-b border-edge pb-4 last:border-0 last:pb-0">
                <a
                  href={typeof r.url === "string" ? r.url : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent transition hover:underline"
                >
                  {title}
                </a>
                {typeof r.url === "string" && (
                  <p className="mt-0.5 truncate text-xs text-muted">{r.url}</p>
                )}
                {snippet && (
                  <p className="mt-1 text-sm text-ink/90">{snippet}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {results && results.length === 0 && !error && (
        <p className="mt-4 text-sm text-muted">
          The request succeeded but no results were recognized. Check the
          response shape against the docs and tighten extractSearchResults().
        </p>
      )}
    </div>
  );
}
