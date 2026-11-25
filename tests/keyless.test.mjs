// Unit tests for the keyless trial module. The network is stubbed.
// Run with `npm test` (Node 22.18 or newer, which loads the TypeScript source
// directly with built-in type stripping).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callKeyless,
  extractArgs,
  isKeylessPath,
  KEYLESS_MCP_URL,
  KeylessError,
  parseMcpReply,
  searchArgs,
  toolFailure,
  toRestShape,
} from "../src/lib/keyless.ts";

const sse = (...messages) =>
  messages.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join("");

const toolReply = (payload, isError = false) => ({
  jsonrpc: "2.0",
  id: 1,
  result: {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload),
      },
    ],
    ...(isError ? { isError: true } : {}),
  },
});

const progress = {
  jsonrpc: "2.0",
  method: "notifications/message",
  params: { level: "info", data: "working" },
};

function stubFetch(body, { status = 200, contentType = "text/event-stream" } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { "content-type": contentType } });
  };
  return { fetchImpl, calls };
}

const rejects = (fn, expected) =>
  assert.rejects(fn, (err) => {
    assert.ok(err instanceof KeylessError, `expected KeylessError, got ${err}`);
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(err[key], value, key);
    }
    return true;
  });

test("only search and extract are keyless paths", () => {
  assert.equal(isKeylessPath("v1/search"), true);
  assert.equal(isKeylessPath("v1/extract"), true);
  assert.equal(isKeylessPath("v1/research"), false);
  assert.equal(isKeylessPath("v1/finance_research"), false);
  assert.equal(isKeylessPath("v1/search/extra"), false);
});

test("searchArgs keeps the supported fields and drops keyed ones", () => {
  assert.deepEqual(
    searchArgs({
      query: "  mcp spec  ",
      count: 5,
      offset: 2,
      freshness: "week",
      safesearch: "strict",
      country: "US",
      include_domains: ["example.com"],
    }),
    {
      query: "mcp spec",
      count: 5,
      extraction: "none",
      offset: 2,
      freshness: "week",
      safesearch: "strict",
    },
  );
});

test("searchArgs defaults, clamps count, and validates freshness", () => {
  assert.deepEqual(searchArgs({ query: "x" }), {
    query: "x",
    count: 10,
    extraction: "none",
  });
  assert.equal(searchArgs({ query: "x", count: 500 }).count, 20);
  assert.equal(searchArgs({ query: "x", count: 0 }).count, 1);
  assert.equal(searchArgs({ query: "x", count: "7" }).count, 10);
  assert.equal(searchArgs({ query: "x", freshness: "decade" }).freshness, undefined);
  assert.equal(
    searchArgs({ query: "x", freshness: "2026-01-01to2026-02-01" }).freshness,
    "2026-01-01to2026-02-01",
  );
  assert.equal(searchArgs({ query: "x", offset: 0 }).offset, undefined);
  assert.equal(searchArgs({ query: "x", offset: 12 }).offset, undefined);
});

test("searchArgs maps highlights but not full page extraction", () => {
  assert.equal(
    searchArgs({ query: "x", extraction: { extraction_mode: "highlights" } }).extraction,
    "highlights",
  );
  assert.equal(
    searchArgs({ query: "x", extraction: { extraction_mode: "full_page" } }).extraction,
    "none",
  );
});

test("searchArgs rejects a missing query or a non-object body", () => {
  for (const body of [{}, { query: "   " }, { query: 3 }, null, "q", ["q"]]) {
    assert.throws(() => searchArgs(body), (err) => err.status === 422);
  }
});

test("extractArgs passes only a normalized http(s) URL", () => {
  assert.deepEqual(
    extractArgs({
      url: " https://example.com/a?b=1 ",
      timeout: 90,
      full_page: { extraction_formats: ["html"] },
    }),
    { url: "https://example.com/a?b=1" },
  );
  for (const url of ["", "notaurl", "ftp://example.com/x", "javascript:alert(1)", undefined]) {
    assert.throws(() => extractArgs({ url }), (err) => err.code === "invalid_request");
  }
});

test("parseMcpReply reads the reply after SSE progress events", () => {
  const reply = toolReply({ results: { web: [] } });
  assert.deepEqual(parseMcpReply(sse(progress, progress, reply), "text/event-stream"), reply);
  // CRLF framing.
  const crlf = sse(progress, reply).replace(/\n/g, "\r\n");
  assert.deepEqual(parseMcpReply(crlf, "text/event-stream; charset=utf-8"), reply);
});

test("parseMcpReply reads a plain JSON body and rejects an empty one", () => {
  const reply = toolReply({ ok: true });
  assert.deepEqual(parseMcpReply(JSON.stringify(reply), "application/json"), reply);
  assert.throws(() => parseMcpReply(sse(progress), "text/event-stream"), (err) => err.status === 502);
  assert.throws(() => parseMcpReply("<html>", "text/html"), (err) => err.status === 502);
});

test("toRestShape returns search as is and unwraps extract output", () => {
  const searchBody = { results: { web: [{ url: "https://a.test", title: "A" }] } };
  assert.deepEqual(toRestShape("v1/search", toolReply(searchBody)), searchBody);

  const page = {
    url: "https://a.test",
    extraction_source: "blend",
    contents: { full_page: { markdown: "# A" } },
  };
  assert.deepEqual(toRestShape("v1/extract", toolReply({ output: page })), page);
});

test("toRestShape turns tool errors into typed failures", () => {
  assert.throws(
    () =>
      toRestShape(
        "v1/extract",
        toolReply("Error extracting content: URL must be a public http or https URL", true),
      ),
    (err) => err.status === 422 && err.message === "URL must be a public http or https URL",
  );
  assert.throws(
    () => toRestShape("v1/search", { id: 1, error: { code: -32602, message: "Tool you-search not found" } }),
    (err) => err.status === 502 && err.retryable === true,
  );
  assert.throws(
    () => toRestShape("v1/search", toolReply("plain text, not JSON")),
    (err) => err.status === 502,
  );
});

test("toolFailure recognizes rate limits and unextractable URLs", () => {
  for (const message of [
    "Rate limit exceeded",
    "Error searching: 429 Too Many Requests",
    "Daily limit reached for the free profile",
    "Free tier quota exhausted",
  ]) {
    const err = toolFailure(message);
    assert.equal(err.status, 429, message);
    assert.equal(err.code, "keyless_rate_limited");
    assert.match(err.message, /Add a You\.com API key/);
  }
  const unreachable = toolFailure(
    "Error extracting content: Extract API request failed. Error code: 422",
  );
  assert.equal(unreachable.status, 422);
  assert.match(unreachable.message, /cannot be extracted/);
});

test("callKeyless sends a stateless tools/call and returns the REST body", async () => {
  const searchBody = { results: { web: [{ url: "https://a.test", title: "A" }] } };
  const { fetchImpl, calls } = stubFetch(sse(progress, toolReply(searchBody)));

  const data = await callKeyless(
    "v1/search",
    { query: "hello", count: 3 },
    { fetchImpl, userAgent: "my-app" },
  );

  assert.deepEqual(data, searchBody);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, KEYLESS_MCP_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.accept, "application/json, text/event-stream");
  assert.equal(calls[0].init.headers["user-agent"], "my-app");
  assert.equal("x-api-key" in calls[0].init.headers, false);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "you-search",
      arguments: { query: "hello", count: 3, extraction: "none" },
    },
  });
});

test("callKeyless routes extract to you-extract with only the URL", async () => {
  const page = { url: "https://a.test/", contents: { full_page: { markdown: "# A" } } };
  const { fetchImpl, calls } = stubFetch(sse(toolReply({ output: page })));

  const data = await callKeyless(
    "v1/extract",
    { url: "https://a.test", parse_effort: "lite" },
    { fetchImpl },
  );

  assert.deepEqual(data, page);
  assert.deepEqual(JSON.parse(calls[0].init.body).params, {
    name: "you-extract",
    arguments: { url: "https://a.test/" },
  });
});

test("callKeyless rejects a bad body without calling the network", async () => {
  const { fetchImpl, calls } = stubFetch("");
  await rejects(() => callKeyless("v1/search", {}, { fetchImpl }), {
    status: 422,
    code: "invalid_request",
  });
  assert.equal(calls.length, 0);
});

test("callKeyless maps HTTP 429 and 5xx from the endpoint", async () => {
  await rejects(
    () => callKeyless("v1/search", { query: "x" }, stubFetch("slow down", { status: 429 })),
    { status: 429, code: "keyless_rate_limited", retryable: false },
  );
  await rejects(
    () => callKeyless("v1/search", { query: "x" }, stubFetch("oops", { status: 503 })),
    { status: 502, code: "keyless_upstream_error", retryable: true },
  );
  await rejects(
    () => callKeyless("v1/search", { query: "x" }, stubFetch("no", { status: 406 })),
    { status: 502, retryable: false },
  );
});

test("callKeyless maps network failures and timeouts", async () => {
  await rejects(
    () =>
      callKeyless("v1/search", { query: "x" }, {
        fetchImpl: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    { status: 502, code: "keyless_upstream_error", retryable: true },
  );
  await rejects(
    () =>
      callKeyless("v1/search", { query: "x" }, {
        timeoutMs: 20,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason));
          }),
      }),
    { status: 504, code: "keyless_timeout", retryable: true },
  );
});
