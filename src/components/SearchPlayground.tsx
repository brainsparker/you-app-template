"use client";

import { useRef, useState } from "react";
import { useApiKey } from "@/lib/api-key";
import {
  extract,
  extractedMarkdown,
  extractSearchResults,
  resultSnippet,
  search,
  YouApiError,
  type YouSearchResult,
} from "@/lib/you-client";

type PageState =
  | { status: "loading" }
  | { status: "ready"; markdown: string; latencyMs: number }
  | { status: "empty" }
  | { status: "error"; message: string };

/** What to tell the visitor when a call fails, by mode and status. */
function describeError(err: unknown, keyless: boolean): string {
  if (err instanceof YouApiError) {
    if ((err.status === 401 || err.status === 403) && !keyless) {
      return `That key was rejected (${err.status}). Remove it and paste a valid You.com API key.`;
    }
    if (err.status === 429 && keyless) {
      return "The keyless free tier is out of queries for now (100 per day, shared by this deployment). Add your own key to keep going.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Request failed.";
}

/**
 * Minimal live demo proving the proxy pipeline end to end, with or without a
 * key: browser -> /api/you/v1/search and /api/you/v1/extract (edge) ->
 * You.com -> results, then any result read as Markdown.
 */
export function SearchPlayground() {
  const { apiKey, mode, clearApiKey } = useApiKey();
  const keyless = !apiKey && mode === "keyless";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [pages, setPages] = useState<Record<string, PageState>>({});
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    const q = query.trim();
    if (!q || (!apiKey && !keyless)) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResults(null);
    setLatencyMs(null);
    setPages({});
    setOpenUrl(null);

    const started = performance.now();
    try {
      const data = await search(apiKey, { query: q }, controller.signal);
      setLatencyMs(Math.round(performance.now() - started));
      setResults(extractSearchResults(data));
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(describeError(err, keyless));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function togglePage(url: string) {
    if (openUrl === url) {
      setOpenUrl(null);
      return;
    }
    setOpenUrl(url);
    setCopied(false);

    const cached = pages[url];
    if (!cached || cached.status === "error") void loadPage(url);
  }

  async function loadPage(url: string) {
    setPages((p) => ({ ...p, [url]: { status: "loading" } }));
    const started = performance.now();
    try {
      // Stay under Webflow Cloud's 20 second request ceiling.
      const page = await extract(apiKey, { url, timeout: 15 });
      const markdown = extractedMarkdown(page);
      setPages((p) => ({
        ...p,
        [url]: markdown
          ? {
              status: "ready",
              markdown,
              latencyMs: Math.round(performance.now() - started),
            }
          : { status: "empty" },
      }));
    } catch (err) {
      setPages((p) => ({
        ...p,
        [url]: { status: "error", message: describeError(err, keyless) },
      }));
    }
  }

  async function copy(markdown: string) {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
    } catch {
      // Clipboard unavailable (insecure context); the text is still selectable.
    }
  }

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Live search playground
        </h3>
        <div className="flex gap-2">
          <code className="rounded bg-surface px-2 py-1 text-xs text-muted">
            POST /v1/search
          </code>
          <code className="rounded bg-surface px-2 py-1 text-xs text-muted">
            POST /v1/extract
          </code>
        </div>
      </div>

      {keyless && (
        <p className="mt-3 text-xs text-muted">
          Keyless trial: these calls run on You.com&apos;s free tier with no API
          key, 100 queries per day shared by this deployment.{" "}
          <button
            type="button"
            onClick={clearApiKey}
            className="underline transition hover:text-ink"
          >
            Add your key
          </button>{" "}
          for your own quota and the full API.
        </p>
      )}

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
          {(error.includes("key was rejected") ||
            (keyless && error.includes("keyless"))) && (
            <button
              type="button"
              onClick={clearApiKey}
              className="underline transition hover:text-red-100"
            >
              {keyless ? "Add a key" : "Remove saved key"}
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
            const url = typeof r.url === "string" ? r.url : null;
            const title =
              (typeof r.title === "string" && r.title) ||
              (typeof r.name === "string" && r.name) ||
              r.url;
            const snippet = resultSnippet(r);
            const page = url ? pages[url] : undefined;
            const open = url !== null && openUrl === url;
            return (
              <li key={`${r.url}-${i}`} className="border-b border-edge pb-4 last:border-0 last:pb-0">
                <a
                  href={url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent transition hover:underline"
                >
                  {title}
                </a>
                {url && (
                  <p className="mt-0.5 truncate text-xs text-muted">{url}</p>
                )}
                {snippet && (
                  <p className="mt-1 text-sm text-ink/90">{snippet}</p>
                )}
                {url && (
                  <button
                    type="button"
                    onClick={() => togglePage(url)}
                    aria-expanded={open}
                    className="mt-2 text-xs text-muted underline transition hover:text-ink"
                  >
                    {open ? "Hide page" : "Read page"}
                  </button>
                )}
                {open && page?.status === "loading" && (
                  <p className="mt-2 text-xs text-muted">
                    Extracting the page as Markdown...
                  </p>
                )}
                {open && page?.status === "empty" && (
                  <p className="mt-2 text-xs text-muted">
                    Nothing could be extracted from this page.
                  </p>
                )}
                {open && page?.status === "error" && (
                  <p className="mt-2 text-xs text-red-300">
                    {page.message}{" "}
                    <button
                      type="button"
                      onClick={() => void loadPage(url)}
                      className="underline transition hover:text-red-100"
                    >
                      Try again
                    </button>
                  </p>
                )}
                {open && page?.status === "ready" && (
                  <div className="mt-2 rounded-lg border border-edge bg-surface">
                    <div className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2 text-xs text-muted">
                      <span>
                        {page.markdown.length.toLocaleString()} characters of
                        Markdown in {page.latencyMs} ms
                      </span>
                      <button
                        type="button"
                        onClick={() => void copy(page.markdown)}
                        className="underline transition hover:text-ink"
                      >
                        {copied ? "Copied" : "Copy Markdown"}
                      </button>
                    </div>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-5 text-ink/90">
                      {page.markdown}
                    </pre>
                  </div>
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
