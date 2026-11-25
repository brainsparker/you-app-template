/**
 * Keyless trial mode (server side).
 *
 * You.com serves a free, keyless tool set at https://api.you.com/mcp/free:
 * you-search and you-extract, 100 queries per day, no API key and no sign-in.
 * This module lets the /api/you proxy answer POST /v1/search and
 * POST /v1/extract from that endpoint when a visitor has not added a key yet,
 * and reshapes the answers to match the REST responses, so browser code is
 * the same in both modes.
 *
 * The endpoint speaks MCP (JSON-RPC over Streamable HTTP). A stateless
 * tools/call is all this needs, so there is no MCP SDK dependency here.
 *
 * This file imports nothing, on purpose: tests/keyless.test.mjs loads it
 * directly with Node's type stripping.
 */

export const KEYLESS_MCP_URL = "https://api.you.com/mcp/free";

/** Proxy paths the keyless tier can serve. Everything else needs a key. */
export const KEYLESS_PATHS = ["v1/search", "v1/extract"] as const;

export type KeylessPath = (typeof KEYLESS_PATHS)[number];

/** Stay under Webflow Cloud's 20 second request ceiling. */
export const KEYLESS_TIMEOUT_MS = 18_000;

const FRESHNESS = /^(day|week|month|year|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$/;
const SAFESEARCH = new Set(["off", "moderate", "strict"]);

export type KeylessErrorCode =
  | "invalid_request"
  | "keyless_rate_limited"
  | "keyless_upstream_error"
  | "keyless_timeout";

/** A failure with the HTTP status and stable code the proxy should answer with. */
export class KeylessError extends Error {
  status: number;
  code: KeylessErrorCode;
  retryable: boolean;

  constructor(
    message: string,
    status: number,
    code: KeylessErrorCode,
    retryable = false,
  ) {
    super(message);
    this.name = "KeylessError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function isKeylessPath(path: string): path is KeylessPath {
  return (KEYLESS_PATHS as readonly string[]).includes(path);
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new KeylessError(
      "Request body must be a JSON object.",
      422,
      "invalid_request",
    );
  }
  return body as Record<string, unknown>;
}

/**
 * Map a POST /v1/search body to you-search arguments.
 *
 * Only query, count, offset, freshness, safesearch, and the highlights
 * extraction mode carry over. Anything else (domain filters, country,
 * full page extraction) is a keyed feature and is dropped, not rejected, so
 * a request written for the keyed API still returns results.
 */
export function searchArgs(body: unknown): Record<string, unknown> {
  const input = asObject(body);
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) {
    throw new KeylessError("query is required.", 422, "invalid_request");
  }

  const args: Record<string, unknown> = { query, count: 10, extraction: "none" };

  if (Number.isInteger(input.count)) {
    args.count = Math.min(Math.max(input.count as number, 1), 20);
  }
  if (Number.isInteger(input.offset)) {
    const offset = input.offset as number;
    if (offset >= 1 && offset <= 9) args.offset = offset;
  }
  if (typeof input.freshness === "string" && FRESHNESS.test(input.freshness)) {
    args.freshness = input.freshness;
  }
  if (typeof input.safesearch === "string" && SAFESEARCH.has(input.safesearch)) {
    args.safesearch = input.safesearch;
  }

  const extraction = input.extraction;
  if (
    typeof extraction === "object" &&
    extraction !== null &&
    (extraction as Record<string, unknown>).extraction_mode === "highlights"
  ) {
    args.extraction = "highlights";
  }

  return args;
}

/**
 * Map a POST /v1/extract body to you-extract arguments. Keyless callers may
 * pass only the URL; formats, extraction_source, timeout, and parse_effort
 * are keyed options and the upstream defaults (Markdown, blend) apply.
 */
export function extractArgs(body: unknown): Record<string, unknown> {
  const input = asObject(body);
  const raw = typeof input.url === "string" ? input.url.trim() : "";
  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new KeylessError(
      "url must be a public http or https URL.",
      422,
      "invalid_request",
    );
  }
  return { url: parsed.toString() };
}

type JsonRpcReply = {
  id?: unknown;
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
};

/**
 * Pull the JSON-RPC reply out of an MCP HTTP response body. The server answers
 * with Server-Sent Events (progress notifications first, the reply last) or
 * with a single JSON object, depending on the request.
 */
export function parseMcpReply(raw: string, contentType: string): JsonRpcReply {
  const candidates: string[] = [];

  if (contentType.includes("text/event-stream")) {
    for (const event of raw.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) candidates.push(data);
    }
  } else {
    candidates.push(raw);
  }

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as JsonRpcReply;
      if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) {
        return parsed;
      }
    } catch {
      // Not JSON; keep looking.
    }
  }

  throw new KeylessError(
    "The keyless endpoint returned no usable reply.",
    502,
    "keyless_upstream_error",
    true,
  );
}

const RATE_LIMIT_HINT = /rate.?limit|too many requests|quota|daily limit|\b429\b/i;

const RATE_LIMIT_MESSAGE =
  "The keyless free tier is out of queries for now (100 per day). Add a You.com API key to keep going.";

/** Turn a tool-level failure message into the error the proxy should return. */
export function toolFailure(message: string): KeylessError {
  const clean = message.replace(/^Error [a-z ]+: /i, "").trim() || "Request failed.";

  if (RATE_LIMIT_HINT.test(clean)) {
    return new KeylessError(RATE_LIMIT_MESSAGE, 429, "keyless_rate_limited");
  }
  if (/validation error|invalid arguments|must be a public|Error code: 422/i.test(clean)) {
    return new KeylessError(
      /Error code: 422/.test(clean)
        ? "That URL cannot be extracted. Check that it is a public, reachable page or PDF."
        : clean,
      422,
      "invalid_request",
    );
  }
  return new KeylessError(clean, 502, "keyless_upstream_error", true);
}

/**
 * Unwrap a successful tool result into the REST response shape.
 * you-search already returns the /v1/search body. you-extract wraps the
 * /v1/extract body in an "output" object, which is removed here.
 */
export function toRestShape(path: KeylessPath, reply: JsonRpcReply): unknown {
  if (reply.error) {
    throw toolFailure(reply.error.message ?? "Request failed.");
  }

  const text = (reply.result?.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");

  if (reply.result?.isError) throw toolFailure(text);

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new KeylessError(
      "The keyless endpoint returned a reply that is not JSON.",
      502,
      "keyless_upstream_error",
      true,
    );
  }

  if (
    path === "v1/extract" &&
    typeof payload === "object" &&
    payload !== null &&
    "output" in payload
  ) {
    return (payload as { output: unknown }).output;
  }
  return payload;
}

export type KeylessOptions = {
  /** Injected in tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Sent as the User-Agent so You.com can attribute keyless traffic to the app. */
  userAgent?: string;
  timeoutMs?: number;
};

/**
 * Answer a proxied REST request from the keyless tier. Returns the body the
 * keyed API would have returned, or throws a KeylessError.
 */
export async function callKeyless(
  path: KeylessPath,
  body: unknown,
  options: KeylessOptions = {},
): Promise<unknown> {
  const tool = path === "v1/search" ? "you-search" : "you-extract";
  const args = path === "v1/search" ? searchArgs(body) : extractArgs(body);
  const doFetch = options.fetchImpl ?? fetch;

  let res: Response;
  let raw: string;
  try {
    res = await doFetch(KEYLESS_MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The server answers 406 unless both types are accepted.
        accept: "application/json, text/event-stream",
        "user-agent": options.userAgent ?? "you-app-template",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? KEYLESS_TIMEOUT_MS),
    });
    raw = await res.text();
  } catch (err) {
    const timedOut =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new KeylessError(
      timedOut
        ? "The keyless endpoint took too long to answer. Try again."
        : "Could not reach the keyless endpoint. Try again.",
      timedOut ? 504 : 502,
      timedOut ? "keyless_timeout" : "keyless_upstream_error",
      true,
    );
  }

  if (res.status === 429) {
    throw new KeylessError(RATE_LIMIT_MESSAGE, 429, "keyless_rate_limited");
  }
  if (!res.ok) {
    throw new KeylessError(
      `The keyless endpoint answered ${res.status}.`,
      502,
      "keyless_upstream_error",
      res.status >= 500,
    );
  }

  const reply = parseMcpReply(raw, res.headers.get("content-type") ?? "");
  return toRestShape(path, reply);
}
