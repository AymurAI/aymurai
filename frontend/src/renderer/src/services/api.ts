import axios from "axios";

import { getServerHost } from "@/store/useLocal";
import { isWebApp } from "@/utils/app-mode";
import { isUsableOrigin, toApiBaseUrl } from "./api-base-url";

const api = axios.create();

/**
 * Resolves the API base URL once, at module load, in strict precedence:
 *
 *  1. VITE_DEV_HOST — dev-only escape hatch so `pnpm dev:web` can render the
 *     APIProtected screens without walking the connect flow.
 *  2. A host the user explicitly saved on /home/settings/server — wins on both
 *     platforms.
 *  3. The web app's own origin — the deployed SPA is served by the very API it
 *     talks to, so no manual configuration should ever be required.
 *  4. Nothing. The desktop app with no saved server stays unset; APIProtected
 *     then bounces to /, which routes on to /home/settings/server.
 *
 * Every branch goes through `toApiBaseUrl`, so `/api` is appended exactly once
 * and a stored 1.x value that already ends in /api does not become /api/api.
 */
function resolveInitialBaseUrl(): string | undefined {
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_HOST) {
    return safeApiBaseUrl(import.meta.env.VITE_DEV_HOST);
  }

  const stored = getServerHost();
  if (stored) {
    const resolved = safeApiBaseUrl(stored);
    if (resolved) return resolved;
  }

  // Guard, not a formality: a packaged Electron renderer loads from file://,
  // where window.location.origin is the literal string "null".
  if (isWebApp() && isUsableOrigin(window.location.origin)) {
    return safeApiBaseUrl(window.location.origin);
  }

  return undefined;
}

/** A corrupt stored value must send the user to /home/settings/server, never crash boot. */
function safeApiBaseUrl(host: string): string | undefined {
  try {
    return toApiBaseUrl(host);
  } catch {
    console.warn("Ignoring unparseable server host", host);
    return undefined;
  }
}

api.defaults.baseURL = resolveInitialBaseUrl();

/** Points the client at a new server. Returns the base URL actually applied. */
export function setApiBaseUrl(host: string): string {
  const baseURL = toApiBaseUrl(host);
  api.defaults.baseURL = baseURL;
  return baseURL;
}

/** The base URL currently in use, or `undefined` when no server is configured. */
export function getApiBaseUrl(): string | undefined {
  return api.defaults.baseURL;
}

/**
 * Absolute URL for an API path, for the two SSE clients that use `fetch` and
 * so cannot go through axios. The only sanctioned way to build an API URL
 * outside the axios instance — never concatenate `/api` at a call site.
 */
export function apiUrl(path: string): string {
  const baseURL = api.defaults.baseURL;
  if (!baseURL) {
    throw new Error(
      "No server selected. Connect to a server from the login page first.",
    );
  }
  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export default api;
