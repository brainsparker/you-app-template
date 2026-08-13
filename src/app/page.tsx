import { ApiKeyGate } from "@/components/ApiKeyGate";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { SearchPlayground } from "@/components/SearchPlayground";
import { appConfig } from "@/lib/app-config";

const FEATURES = [
  {
    title: "BYOK by design",
    body: "Visitors bring their own You.com API key. It stays in their browser, rides along per request, and never touches server storage or logs.",
  },
  {
    title: "Edge proxy included",
    body: "api.you.com does not serve CORS headers, so this template ships a locked-down /api/you proxy route that runs on Webflow Cloud's edge runtime.",
  },
  {
    title: "Streaming ready",
    body: "The proxy passes response bodies straight through, so SSE streams from the Research API reach the browser token by token.",
  },
  {
    title: "Webflow Cloud native",
    body: "Mount-path aware routing, OpenNext build config, and wrangler settings are already wired for Webflow Cloud deploys.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Get a key",
    body: "Create a You.com platform account. New accounts include $100 in API credits.",
  },
  {
    n: "2",
    title: "Paste it below",
    body: "Your key is saved in this browser only and attached to each request you make.",
  },
  {
    n: "3",
    title: "Ship your own",
    body: "Fork the template, swap the playground for your product idea, deploy to Webflow Cloud.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        <section className="py-14 text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-accent">
            you.com api starter
          </p>
          <h1 className="mx-auto mt-3 max-w-2xl text-4xl font-bold leading-tight">
            Build on the You.com API. Ship on Webflow Cloud.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            {appConfig.tagline} Every app in this demo family starts from this
            repo.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{f.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-12">
          <div className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="card p-5">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">
                  {s.n}
                </span>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <ApiKeyGate>
            <SearchPlayground />
          </ApiKeyGate>
        </section>

        <section className="mt-12">
          <div className="card p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              How a request flows
            </h3>
            <pre className="mt-4 overflow-x-auto text-xs leading-6 text-muted">
{`browser (key in localStorage)
   |  fetch withBase("/api/you/v1/search"), x-api-key header
   v
this app's edge route on Webflow Cloud (Cloudflare Workers)
   |  path allowlist check, key forwarded, nothing stored
   v
api.you.com  ->  response streams straight back to the browser`}
            </pre>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
