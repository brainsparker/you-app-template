"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * BYOK key handling. The visitor's You.com API key lives in this browser
 * (localStorage) and is attached per request as an x-api-key header to the
 * app's own /api/you proxy route, which forwards it upstream. The key is
 * never stored or logged server-side.
 *
 * A visitor can also start without a key (keyless trial). That choice is a
 * flag in localStorage; requests then go out with no x-api-key header and the
 * proxy answers search and extract from You.com's keyless free tier.
 */
const STORAGE_KEY = "ydc_api_key";
const TRIAL_KEY = "ydc_keyless_trial";

/** keyed: a key is saved. keyless: trial chosen, no key. none: neither yet. */
export type AccessMode = "keyed" | "keyless" | "none";

type ApiKeyContextValue = {
  apiKey: string | null;
  mode: AccessMode;
  /** False until localStorage has been read on the client. */
  ready: boolean;
  setApiKey: (key: string) => void;
  /** Removes the key and ends a keyless trial, returning to the entry card. */
  clearApiKey: () => void;
  startKeyless: () => void;
};

const ApiKeyContext = createContext<ApiKeyContextValue | null>(null);

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [apiKey, setKeyState] = useState<string | null>(null);
  const [trial, setTrial] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setKeyState(window.localStorage.getItem(STORAGE_KEY));
      setTrial(window.localStorage.getItem(TRIAL_KEY) === "1");
    } catch {
      // localStorage unavailable (private browsing etc.); key lives in memory only.
    }
    setReady(true);
  }, []);

  const setApiKey = useCallback((key: string) => {
    const trimmed = key.trim();
    setKeyState(trimmed);
    try {
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      // Ignore: in-memory only.
    }
  }, []);

  const clearApiKey = useCallback(() => {
    setKeyState(null);
    setTrial(false);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(TRIAL_KEY);
    } catch {
      // Ignore.
    }
  }, []);

  const startKeyless = useCallback(() => {
    setTrial(true);
    try {
      window.localStorage.setItem(TRIAL_KEY, "1");
    } catch {
      // Ignore: in-memory only.
    }
  }, []);

  const mode: AccessMode = apiKey ? "keyed" : trial ? "keyless" : "none";

  return (
    <ApiKeyContext.Provider
      value={{ apiKey, mode, ready, setApiKey, clearApiKey, startKeyless }}
    >
      {children}
    </ApiKeyContext.Provider>
  );
}

export function useApiKey(): ApiKeyContextValue {
  const ctx = useContext(ApiKeyContext);
  if (!ctx) throw new Error("useApiKey must be used inside <ApiKeyProvider>");
  return ctx;
}
