"use client";

import { useState } from "react";
import { useApiKey } from "@/lib/api-key";
import { appConfig } from "@/lib/app-config";
import { SignupCta } from "./SignupCta";

/**
 * Renders children once a You.com API key is present; otherwise shows the
 * BYOK entry card. Keys stay in this browser and are sent per request only.
 *
 * With allowKeyless (default: appConfig.keylessTrial) the card also offers a
 * keyless trial, and children render in that mode with a null key. Pass
 * allowKeyless={false} around surfaces that call key-only APIs such as
 * Research.
 */
export function ApiKeyGate({
  children,
  allowKeyless = appConfig.keylessTrial,
}: {
  children: React.ReactNode;
  allowKeyless?: boolean;
}) {
  const { apiKey, mode, ready, setApiKey, startKeyless } = useApiKey();
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);

  if (!ready) {
    return (
      <div className="card p-8 text-center text-sm text-muted">Loading...</div>
    );
  }

  if (apiKey || (allowKeyless && mode === "keyless")) return <>{children}</>;

  return (
    <div className="card mx-auto max-w-lg p-8">
      <h3 className="text-lg font-semibold">Add your You.com API key</h3>
      <p className="mt-2 text-sm text-muted">
        This demo is BYOK: bring your own key. Your key is saved in this
        browser only, attached to each request you make, and never stored or
        logged on our servers.
      </p>
      <div className="mt-5 flex gap-2">
        <input
          className="input flex-1"
          type={show ? "text" : "password"}
          placeholder="Paste your API key"
          value={draft}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) setApiKey(draft);
          }}
        />
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide key" : "Show key"}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={!draft.trim()}
          onClick={() => setApiKey(draft)}
        >
          Save key
        </button>
        <span className="text-sm text-muted">
          No key yet? New accounts include $100 in credits.
        </span>
        <SignupCta className="btn-ghost" label="Create one free" />
      </div>
      {allowKeyless && (
        <div className="mt-6 border-t border-edge pt-5">
          <button type="button" className="btn-ghost" onClick={startKeyless}>
            Try it without a key
          </button>
          <p className="mt-2 text-xs text-muted">
            Search and page extraction run on You.com&apos;s keyless free tier:
            100 queries per day, shared by everyone using this deployment.
            Research and the full set of options need a key.
          </p>
        </div>
      )}
    </div>
  );
}

/** Small header widget showing key status with a change affordance. */
export function ApiKeyChip() {
  const { apiKey, mode, ready, clearApiKey } = useApiKey();

  if (!ready) return null;

  if (!apiKey && mode === "keyless") {
    return (
      <button
        type="button"
        onClick={clearApiKey}
        className="inline-flex items-center gap-2 rounded-full border border-edge px-3 py-1 text-xs text-muted transition hover:border-accent hover:text-ink"
        title="Running on the keyless free tier. Click to add your API key."
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Keyless trial
        <span className="underline">add key</span>
      </button>
    );
  }

  if (!apiKey) return null;

  return (
    <button
      type="button"
      onClick={clearApiKey}
      className="group inline-flex items-center gap-2 rounded-full border border-edge px-3 py-1 text-xs text-muted transition hover:border-accent hover:text-ink"
      title="Your key is stored in this browser only. Click to remove it."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      API key set
      <span className="hidden group-hover:inline">(remove)</span>
    </button>
  );
}
