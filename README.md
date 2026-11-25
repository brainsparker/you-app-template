# you-app-template

Starter template for building You.com-powered apps that deploy to [Webflow Cloud](https://developers.webflow.com/webflow-cloud/intro). Every app in this demo family starts from this repo, including [you-chat](https://github.com/brainsparker/you-chat) and [you-deep-research](https://github.com/brainsparker/you-deep-research).

Run it locally in two commands with no API key, add your own You.com key for the full API, or mount it on a Webflow site in minutes.

## What you get

- **Next.js 15 + TypeScript + Tailwind**, configured for Webflow Cloud's Cloudflare Workers runtime (OpenNext build, wrangler config, mount-path aware routing)
- **A locked-down edge proxy** (`/api/you/*`) for the You.com API. `api.you.com` does not serve CORS headers, so browsers cannot call it directly; this route forwards requests server-side with a path allowlist so it can never be used as an open proxy
- **BYOK key handling**: the visitor's API key lives in their browser (localStorage), is attached per request, and is never stored or logged server-side
- **Keyless trial mode**: until a visitor adds a key, search and page extraction run on You.com's keyless free tier (100 queries per day), in the same response shapes as the keyed API. One flag turns it off
- **Streaming pass-through**: response bodies stream straight back to the browser, so SSE output from the Research API works out of the box
- **Sign-up CTA with UTM attribution**, a typed API client, and a live playground (search, then read any result as Markdown with the Extract API) that proves the whole pipeline end to end

## Quickstart (local)

```bash
git clone https://github.com/brainsparker/you-app-template.git
cd you-app-template
npm install
npm run dev
```

Open http://localhost:3000, click **Try it without a key**, run a search, and click **Read page** on a result. No account needed.

For Research, Finance Research, your own quota, and the full set of request options, create a key at [you.com/platform](https://you.com/platform) and paste it in. New accounts include $100 in API credits.

## Keyless trial mode

You.com serves `you-search` and `you-extract` with no API key at `https://api.you.com/mcp/free`, limited to 100 queries per day ([MCP Server guide](https://you.com/docs/developer-resources/mcp-server)). When a request reaches the proxy with no `x-api-key` header, `src/lib/keyless.ts` answers `POST /v1/search` and `POST /v1/extract` from that endpoint and reshapes the reply to match the REST response, so `search()` and `extract()` in the client work the same in both modes. Pass `null` as the key.

What to know before you rely on it:

- **The quota belongs to the deployment, not the visitor.** Keyless calls leave from your server, not the visitor's browser, so expect every visitor of a public deployment to draw on the same daily allowance. It is a trial, not a way to run production traffic. When the limit is hit the proxy answers `429` with `code: "keyless_rate_limited"` and the playground asks for a key.
- **Search and extract only.** Research and Finance Research always need a key and answer `401` without one.
- **Fewer options.** Keyless search honors `query`, `count` (up to 20), `offset`, `freshness`, `safesearch`, and highlights extraction; other fields are ignored. Keyless extract takes only `url` and returns Markdown.
- **Responses say which tier answered** in an `x-you-mode` header: `keyless` or `keyed`.

To turn it off, set `keylessTrial: false` in `src/lib/app-config.ts`. Do that when your app only makes sense with a key, for example when it is built on the Research API. To keep the trial for some surfaces only, wrap the key-only ones in `<ApiKeyGate allowKeyless={false}>`.

## Architecture

```
browser (key in localStorage, or no key in a keyless trial)
   |  fetch withBase("/api/you/v1/search"), x-api-key header if set
   v
this app's edge route on Webflow Cloud (Cloudflare Workers)
   |  path allowlist check, key forwarded, nothing stored
   |
   |-- key present   ->  api.you.com, response streams straight back
   |-- no key        ->  api.you.com/mcp/free (search and extract only),
                         reshaped to the same response body
```

Key files:

| File | Purpose |
| --- | --- |
| `src/app/api/you/[...path]/route.ts` | Edge proxy with path allowlist and per-request key forwarding |
| `src/lib/keyless.ts` | Keyless trial: answers search and extract from `api.you.com/mcp/free` with no key |
| `src/lib/you-client.ts` | Typed browser client for Search, Extract, Research, and Finance Research |
| `src/lib/api-key.tsx` | BYOK context: localStorage persistence, set/clear, keyless trial flag |
| `src/components/ApiKeyGate.tsx` | Key entry card with the keyless option, and header status chip |
| `src/components/SearchPlayground.tsx` | Search, then read any result as Markdown through the Extract API |
| `tests/keyless.test.mjs` | Unit tests for the keyless module, network stubbed (`npm test`) |
| `src/components/SignupCta.tsx` | Sign-up link with UTM campaign tagging |
| `src/lib/app-config.ts` | One place to rename and rebrand a derived app |
| `next.config.ts` | Reads Webflow Cloud's `BASE_URL` / `ASSETS_PREFIX` for mount-path support |

## Deploy to Webflow Cloud

Prerequisites: a Webflow site on a plan with Webflow Cloud, plus the [Webflow CLI](https://developers.webflow.com/webflow-cloud/getting-started).

1. Fork or use this template, then push to GitHub.
2. `webflow cloud init` in the project root: authenticate, pick your site, and choose a mount path (for example `/demos/template`). The CLI links the GitHub repo and finalizes deployment config.
3. `webflow cloud deploy` for the first deploy. After that, every push to the tracked branch deploys automatically.
4. Set the environment's mount path and Webflow Cloud injects `BASE_URL` and `ASSETS_PREFIX` at build time; the app picks them up with no code changes.

Notes for Webflow Cloud's runtime:

- Requests have a 20 second wall-clock ceiling. Long jobs should use the Research API's async mode and poll, or stream partial output.
- Client-side fetches must be prefixed with the mount path. Always use `withBase()` from `src/lib/utils.ts`; plain `fetch("/api/...")` breaks under a mount path.
- `sharp`, `fs`, and other Node-only modules are unavailable. Prefer `fetch` and Web APIs.

## BYOK security model

- The key is entered by the visitor and saved in their own browser via localStorage. Clearing it is one click.
- Each request carries the key in an `x-api-key` header to this app's own proxy route, which forwards it upstream in the same request. The server keeps no record of it.
- The proxy only accepts the You.com API paths listed in its allowlist, so it cannot be repurposed to call arbitrary hosts.
- Nothing about your queries or results is persisted by the app.
- In keyless trial mode no credential exists at all: requests carry no key, and the server holds none.

## Make it your own

1. Update `src/lib/app-config.ts` (name, title, tagline, repo URL). The name doubles as the UTM campaign on sign-up CTAs.
2. Replace `SearchPlayground` on the landing page with your product surface. The client in `src/lib/you-client.ts` already covers Search, Extract, Research, and Finance Research.
3. Response typing is intentionally loose in the template. Tighten the types against [you.com/docs](https://you.com/docs) for the endpoints you use.
4. Keep the proxy allowlist as small as your app needs.
5. Decide whether your app should work before the key. Leave `keylessTrial` on if search or extract alone shows the product; turn it off if the first useful action needs Research.

## Extract replaces Contents

The Contents API was deprecated on November 16, 2026 in favor of the [Extract API](https://you.com/docs/guides/extract), so this template no longer ships a `contents()` call or proxies `/v1/contents`. Use `extract(apiKey, { url })`: one URL per request, Markdown by default, PDFs included. Failures raise `YouApiError` with the API's stable `code` and `retryable` flag, so retry only when `retryable` is true. On Webflow Cloud pass a `timeout` under the platform's 20 second request ceiling.

## Tests

```bash
npm test
```

Runs the keyless module's unit tests with Node's built-in test runner and a stubbed network. It loads the TypeScript source directly, which needs Node 22.18 or newer; lint, typecheck, and build still run on Node 20.

## License

MIT. See [LICENSE](./LICENSE).
