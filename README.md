# you-app-template

Starter template for building You.com-powered apps that deploy to [Webflow Cloud](https://developers.webflow.com/webflow-cloud/intro). Every app in this demo family starts from this repo, including [you-chat](https://github.com/brainsparker/you-chat) and [you-deep-research](https://github.com/brainsparker/you-deep-research).

Bring your own You.com API key, run it locally in two commands, or mount it on a Webflow site in minutes.

## What you get

- **Next.js 15 + TypeScript + Tailwind**, configured for Webflow Cloud's Cloudflare Workers runtime (OpenNext build, wrangler config, mount-path aware routing)
- **A locked-down edge proxy** (`/api/you/*`) for the You.com API. `api.you.com` does not serve CORS headers, so browsers cannot call it directly; this route forwards requests server-side with a path allowlist so it can never be used as an open proxy
- **BYOK key handling**: the visitor's API key lives in their browser (localStorage), is attached per request, and is never stored or logged server-side
- **Streaming pass-through**: response bodies stream straight back to the browser, so SSE output from the Research API works out of the box
- **Sign-up CTA with UTM attribution**, a typed API client, and a live search playground that proves the whole pipeline end to end

## Quickstart (local)

```bash
git clone https://github.com/brainsparker/you-app-template.git
cd you-app-template
npm install
npm run dev
```

Open http://localhost:3000, paste your You.com API key, and run a search.

No key yet? Create one at [you.com/platform](https://you.com/platform). New accounts include $100 in API credits.

## Architecture

```
browser (key in localStorage)
   |  fetch withBase("/api/you/v1/search"), x-api-key header
   v
this app's edge route on Webflow Cloud (Cloudflare Workers)
   |  path allowlist check, key forwarded, nothing stored
   v
api.you.com  ->  response streams straight back to the browser
```

Key files:

| File | Purpose |
| --- | --- |
| `src/app/api/you/[...path]/route.ts` | Edge proxy with path allowlist and per-request key forwarding |
| `src/lib/you-client.ts` | Typed browser client for Search, Contents, Research, and Finance Research |
| `src/lib/api-key.tsx` | BYOK context: localStorage persistence, set/clear |
| `src/components/ApiKeyGate.tsx` | Key entry card and header status chip |
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

## Make it your own

1. Update `src/lib/app-config.ts` (name, title, tagline, repo URL). The name doubles as the UTM campaign on sign-up CTAs.
2. Replace `SearchPlayground` on the landing page with your product surface. The client in `src/lib/you-client.ts` already covers Search, Contents, Research, and Finance Research.
3. Response typing is intentionally loose in the template. Tighten the types against [you.com/docs](https://you.com/docs) for the endpoints you use.
4. Keep the proxy allowlist as small as your app needs.

## License

MIT. See [LICENSE](./LICENSE).
