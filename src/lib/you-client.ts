import { withBase } from "./utils";

/**
 * Browser-side client for the You.com API, routed through this app's own
 * /api/you proxy (api.you.com does not serve CORS headers, so direct browser
 * calls are not possible). The visitor's key is attached per request.
 *
 * search() and extract() also accept a null key. With appConfig.keylessTrial
 * on, the proxy answers those from You.com's keyless free tier in the same
 * response shape, so calling code does not branch on the mode.
 *
 * Response typing is intentionally loose: exact response contracts should be
 * confirmed against https://you.com/docs and tightened per app.
 */

export type YouSearchResult = {
  url?: string;
  title?: string;
  name?: string;
  description?: string;
  snippet?: string;
  snippets?: string[];
  [key: string]: unknown;
};

export class YouApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Stable machine-readable code, when the API or the proxy sent one. */
    public code?: string,
    /** True when the same request can succeed on a later try. */
    public retryable?: boolean,
  ) {
    super(message);
    this.name = "YouApiError";
  }
}

type ErrorBody = {
  // A string from this app's proxy, an object from the Extract API.
  error?: string | { code?: string; message?: string; retryable?: boolean };
  detail?: string;
  message?: string;
  code?: string;
  retryable?: boolean;
};

async function request<T>(
  path: string,
  apiKey: string | null,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  // No key means keyless trial mode; the proxy decides whether to serve it.
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(withBase(`/api/you/${path}`), {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });

  if (!res.ok) {
    let detail = res.statusText || `Request failed (${res.status})`;
    let code: string | undefined;
    let retryable: boolean | undefined;
    try {
      const data = (await res.json()) as ErrorBody;
      if (typeof data.error === "object" && data.error !== null) {
        detail = data.error.message ?? detail;
        code = data.error.code;
        retryable = data.error.retryable;
      } else {
        detail = data.error ?? data.detail ?? data.message ?? detail;
        code = data.code;
        retryable = data.retryable;
      }
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new YouApiError(detail, res.status, code, retryable);
  }

  return (await res.json()) as T;
}

/**
 * POST /v1/search: real-time, LLM-ready web results.
 * With a null key (keyless trial) only query, count, offset, freshness,
 * safesearch, and highlights extraction apply; other fields are ignored.
 */
export function search(
  apiKey: string | null,
  params: { query: string; [key: string]: unknown },
  signal?: AbortSignal,
): Promise<unknown> {
  return request("v1/search", apiKey, { body: params, signal });
}

// --- Extract API (contract verified against you.com/docs, 2026-11-25) ---
// Replaces the Contents API, which was deprecated on 2026-11-16.

export type ExtractParams = {
  /** The webpage or PDF URL to extract. One URL per request. */
  url: string;
  /** Defaults to Markdown only. */
  full_page?: { extraction_formats: Array<"markdown" | "html"> };
  /** blend (default): cache when available, live crawl otherwise. */
  extraction_source?: "blend" | "cache" | "fetch";
  /** Seconds for the whole request, 2 to 100. Default 30. */
  timeout?: number;
  /** PDF pages only. standard (default) is billed per page. */
  parse_effort?: "lite" | "standard";
};

export type ExtractResult = {
  url?: string;
  extraction_source?: string;
  title?: string;
  /** Missing when nothing could be extracted, so check before reading. */
  contents?: { full_page?: { markdown?: string; html?: string } };
  metadata?: { site_name?: string; favicon_url?: string };
};

/**
 * POST /v1/extract: one webpage or PDF as clean Markdown or HTML.
 * With a null key (keyless trial) only url applies and Markdown comes back.
 * Errors carry a stable code and a retryable flag on YouApiError: retry only
 * when retryable is true. On Webflow Cloud keep timeout under the platform's
 * 20 second request ceiling.
 */
export function extract(
  apiKey: string | null,
  params: ExtractParams,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  return request("v1/extract", apiKey, {
    body: apiKey ? params : { url: params.url },
    signal,
  });
}

/** The extracted Markdown, or undefined when the page yielded nothing. */
export function extractedMarkdown(result: ExtractResult): string | undefined {
  const markdown = result.contents?.full_page?.markdown;
  return typeof markdown === "string" && markdown.trim() ? markdown : undefined;
}

// --- Research API (contract verified against you.com/docs, 2026-08-12) ---

export type ResearchEffort =
  | "lite"
  | "standard"
  | "deep"
  | "exhaustive"
  | "frontier";

export type ResearchSource = {
  url: string;
  title?: string;
  /** Relevant excerpts from the source used in the answer. */
  snippets?: string[];
};

export type ResearchOutput = {
  output: {
    /**
     * Markdown with numbered citations like [[1]] referencing sources.
     * A JSON object instead when output_schema was provided.
     */
    content: string | Record<string, unknown>;
    content_type: "text" | "object";
    sources: ResearchSource[];
  };
  warnings: string[];
};

/** Returned immediately when background: true. */
export type ResearchTask = {
  task_id: string;
  type: string;
  status: string;
  stream_url: string;
  created_at: string;
};

export type ResearchTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ResearchTaskDetail = {
  id: string;
  task_type: string;
  status: ResearchTaskStatus;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  error: string | null;
  input: unknown;
  result: ResearchOutput | null;
};

/**
 * Constrain which web sources the research agent may search and visit.
 * include_domains cannot be combined with exclude_domains or boost_domains,
 * and boost_domains cannot be combined with include_domains (max 500 each).
 */
export type SourceControl = {
  /** Only return results from these domains. */
  include_domains?: string[];
  /** Never return results from these domains (also blocks browsing them). */
  exclude_domains?: string[];
  /** Prefer these domains without excluding others. */
  boost_domains?: string[];
  /** "day" | "week" | "month" | "year" | "YYYY-MM-DDtoYYYY-MM-DD". */
  freshness?: string;
  /** ISO 3166-1 alpha-2 country code, e.g. "US". */
  country?: string;
};

export type ResearchParams = {
  /** The research question, max 40,000 characters. */
  input: string;
  /**
   * lite <10s, standard ~10-30s (default), deep <120s,
   * exhaustive <300s, frontier requires background: true.
   */
  research_effort?: ResearchEffort;
  /** Constrain sources by domain, freshness, or country (beta). */
  source_control?: SourceControl;
  /** Structured output (not supported with lite). */
  output_schema?: Record<string, unknown>;
  /** Queue as a background task and return a handle immediately. */
  background?: boolean;
  [key: string]: unknown;
};

/**
 * POST /v1/research: grounded answers with inline citations.
 * Synchronous unless params.background is true. On Webflow Cloud, keep
 * synchronous calls at lite/standard effort (20 second request ceiling)
 * and use background mode + polling for deep/exhaustive/frontier.
 */
export function research(
  apiKey: string,
  params: ResearchParams & { background: true },
  signal?: AbortSignal,
): Promise<ResearchTask>;
export function research(
  apiKey: string,
  params: ResearchParams,
  signal?: AbortSignal,
): Promise<ResearchOutput>;
export function research(
  apiKey: string,
  params: ResearchParams,
  signal?: AbortSignal,
): Promise<ResearchOutput | ResearchTask> {
  return request("v1/research", apiKey, { body: params, signal });
}

/** GET /v1/research/{task_id}: poll a background task for status/result. */
export function getResearchTask(
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<ResearchTaskDetail> {
  return request(`v1/research/${taskId}`, apiKey, { method: "GET", signal });
}

/**
 * URL (behind this app's proxy) for a task's Server-Sent Events stream.
 * Note Webflow Cloud's 20 second request ceiling also applies to a proxied
 * SSE connection: reconnect with ?from_id=<last event id> to resume.
 */
export function researchTaskStreamPath(taskId: string, fromId = 0): string {
  return `/api/you/v1/research/${taskId}/stream${fromId ? `?from_id=${fromId}` : ""}`;
}

export type FinanceResearchParams = {
  /** The financial research question, max 40,000 characters. */
  input: string;
  /** deep (default, <120s) or exhaustive (<300s). No other levels. */
  research_effort?: "deep" | "exhaustive";
  [key: string]: unknown;
};

/**
 * POST /v1/finance_research: research over a finance-optimized index
 * (fundamentals, prices, SEC filings, analyst coverage, financial news).
 * Same response shape as the Research API, but synchronous only: no
 * background mode, no output_schema, no source_control. On Webflow Cloud,
 * calls can exceed the platform's 20 second request ceiling; handle that
 * failure and offer a Research API background retry.
 */
export function financeResearch(
  apiKey: string,
  params: FinanceResearchParams,
  signal?: AbortSignal,
): Promise<ResearchOutput> {
  return request("v1/finance_research", apiKey, { body: params, signal });
}

/**
 * Defensively extract result objects (anything with a url and a title-like
 * field) from a response whose exact shape may evolve. Replace with exact
 * types once the response contract for your endpoint is confirmed.
 */
export function extractSearchResults(data: unknown): YouSearchResult[] {
  const found: YouSearchResult[] = [];

  const visit = (node: unknown, depth: number): void => {
    if (found.length >= 20 || depth > 5 || node === null || node === undefined)
      return;

    if (Array.isArray(node)) {
      const objects = node.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      );
      const resultLike = objects.filter(
        (o) =>
          typeof o.url === "string" &&
          (typeof o.title === "string" || typeof o.name === "string"),
      );
      if (resultLike.length > 0) {
        for (const o of resultLike) found.push(o as YouSearchResult);
        return;
      }
      for (const item of node) visit(item, depth + 1);
      return;
    }

    if (typeof node === "object") {
      for (const value of Object.values(node as Record<string, unknown>)) {
        visit(value, depth + 1);
      }
    }
  };

  visit(data, 0);
  return found.slice(0, 20);
}

/** Pull the best available snippet text off a loosely-typed result. */
export function resultSnippet(result: YouSearchResult): string | undefined {
  if (typeof result.description === "string") return result.description;
  if (typeof result.snippet === "string") return result.snippet;
  if (Array.isArray(result.snippets) && typeof result.snippets[0] === "string")
    return result.snippets[0];
  return undefined;
}
