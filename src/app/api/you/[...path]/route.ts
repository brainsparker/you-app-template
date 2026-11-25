import { appConfig } from "@/lib/app-config";
import { callKeyless, isKeylessPath, KeylessError } from "@/lib/keyless";

/**
 * Edge proxy for the You.com API.
 *
 * Why this exists: api.you.com does not serve CORS headers, so browsers cannot
 * call it directly. This route forwards requests server-side on Webflow Cloud's
 * edge runtime. The visitor's API key arrives as an x-api-key header, is
 * forwarded upstream in the same request, and is never stored or logged.
 *
 * Abuse guard: only the API paths listed below may be proxied, so this route
 * cannot be used as an open proxy.
 *
 * Keyless trial: when appConfig.keylessTrial is on and a request arrives with
 * no key, POST /v1/search and POST /v1/extract are answered from You.com's
 * keyless free tier (see src/lib/keyless.ts) in the same response shape.
 * Every other path still requires a key.
 *
 * Note: do NOT add `export const runtime = "edge"` here. Webflow Cloud builds
 * with OpenNext, which rejects edge-runtime route handlers; this route already
 * runs on Cloudflare Workers via OpenNext's Node-compatible runtime.
 */
const UPSTREAM = "https://api.you.com";

// The Extract API is documented on its own host.
const UPSTREAM_OVERRIDES: Record<string, string> = {
  "v1/extract": "https://ydc-index.io",
};

const ALLOWED_PATHS = [
  "v1/search",
  "v1/extract",
  "v1/research",
  "v1/finance_research",
];

/** Tells the browser which tier answered: "keyed" or "keyless". */
const MODE_HEADER = "x-you-mode";

async function keyless(req: Request, path: "v1/search" | "v1/extract") {
  const headers = { [MODE_HEADER]: "keyless" };
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new KeylessError(
        "Request body must be a JSON object.",
        422,
        "invalid_request",
      );
    }
    const data = await callKeyless(path, body, { userAgent: appConfig.name });
    return Response.json(data, { headers });
  } catch (err) {
    if (err instanceof KeylessError) {
      return Response.json(
        { error: err.message, code: err.code, retryable: err.retryable },
        { status: err.status, headers },
      );
    }
    throw err;
  }
}

// Never forward these from the incoming request.
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "cookie",
  "accept-encoding",
]);

// Only these come back to the browser (content-type covers SSE streams).
const FORWARD_RESPONSE_HEADERS = new Set([
  "content-type",
  "x-request-id",
]);

async function proxy(req: Request, pathSegments: string[]): Promise<Response> {
  const joined = pathSegments.join("/");

  const allowed = ALLOWED_PATHS.some(
    (p) => joined === p || joined.startsWith(`${p}/`),
  );
  if (!allowed) {
    return Response.json(
      { error: `Path not allowed: /${joined}` },
      { status: 404 },
    );
  }

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    if (
      appConfig.keylessTrial &&
      req.method === "POST" &&
      isKeylessPath(joined)
    ) {
      return keyless(req, joined);
    }
    return Response.json(
      {
        error: appConfig.keylessTrial
          ? "This endpoint needs a You.com API key. Only search and extract run without one."
          : "Missing x-api-key header. Add your You.com API key in the app to continue.",
      },
      { status: 401 },
    );
  }

  const incoming = new URL(req.url);
  const upstreamBase = UPSTREAM_OVERRIDES[joined] ?? UPSTREAM;
  const upstreamUrl = `${upstreamBase}/${joined}${incoming.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  headers.set("x-api-key", apiKey);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    // Request bodies here are small JSON payloads; buffering avoids
    // streaming-body (duplex) edge cases across runtimes.
    body: hasBody ? await req.arrayBuffer() : undefined,
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (FORWARD_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });
  responseHeaders.set(MODE_HEADER, "keyed");

  // Stream the upstream body straight through (supports SSE).
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: Request, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
