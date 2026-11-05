import { isElectronApp } from "@/utils/app-mode";

const API_PREFIX = "/api";

/**
 * `window.location.origin` is the string "null" on an opaque origin — which is
 * exactly what a packaged Electron renderer loaded from file:// reports. Never
 * feed it to `new URL()`; callers must check this first.
 */
export function isUsableOrigin(origin: string): boolean {
  return origin !== "null" && origin !== "";
}

function defaultScheme(): string {
  // A user typing "10.0.0.5:8899" into the desktop app means http. In the
  // browser, mirror the page so an https deployment never downgrades.
  if (isElectronApp()) return "http:";
  return isUsableOrigin(window.location.origin)
    ? window.location.protocol
    : "http:";
}

/**
 * The canonical STORED and DISPLAYED form of a server address: an absolute URL
 * with no trailing slash and no `/api` suffix. Users work with the base URL;
 * `/api` is an implementation detail added by `toApiBaseUrl`.
 *
 * @throws {TypeError} when the input cannot be parsed as a URL.
 */
export function normalizeServerHost(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new TypeError("Empty server host");

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);

  // A scheme-less value starting with "/" (e.g. "/api", "//evil.com") is a
  // path or protocol-relative reference, not a host. Left unchecked, prefixing
  // it with "scheme://" produces three-plus slashes in a row; the WHATWG URL
  // parser then reads the segment right after those slashes as the hostname
  // instead of as a path, so `url.hostname` comes back non-empty and the
  // parse-failure guard below never fires — silently yielding a garbage base
  // URL instead of throwing. Reject it here, before it ever reaches `new URL`.
  if (!hasScheme && trimmed.startsWith("/")) {
    throw new TypeError(`Unparseable server host: ${input}`);
  }

  const withScheme = hasScheme ? trimmed : `${defaultScheme()}//${trimmed}`;

  const url = new URL(withScheme);
  if (!url.hostname) throw new TypeError(`Unparseable server host: ${input}`);

  // Keep only origin + pathname: query and hash are never part of a base URL,
  // and silently carrying them would corrupt every request built from it.
  const base = `${url.origin}${url.pathname}`.replace(/\/+$/, "");

  return base.endsWith(API_PREFIX)
    ? base.slice(0, -API_PREFIX.length).replace(/\/+$/, "")
    : base;
}

/**
 * The base URL the HTTP client actually uses. Idempotent: feeding it a value
 * that already ends in `/api` yields the same string, never `/api/api`.
 */
export function toApiBaseUrl(input: string): string {
  return `${normalizeServerHost(input)}${API_PREFIX}`;
}

/**
 * Inverse of `toApiBaseUrl`: the canonical, displayable server address behind
 * a client base URL. Used to name the server a user is already talking to when
 * nothing was ever saved by hand — the web app resolves its own origin.
 */
export function fromApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith(API_PREFIX)
    ? trimmed.slice(0, -API_PREFIX.length).replace(/\/+$/, "")
    : trimmed;
}
