import { getApiBaseUrl } from "@/services/api";
import { fromApiBaseUrl } from "@/services/api-base-url";
import * as localStore from "@/store/useLocal";

/**
 * The server address the client is actually configured with, in its canonical
 * displayable form (no `/api` suffix), or `null` when there is none.
 *
 * `api.defaults.baseURL` is the source of truth — the web app resolves its own
 * origin when the user never saved a host — but it is a plain axios field, not
 * reactive state. Reading the stored host here is what re-renders callers:
 * every action that changes the base URL (connect, disconnect) writes the
 * store in the same step.
 */
export function useConnectedHost(): string | null {
  const storedHost = localStore.useServerHost();
  const baseUrl = getApiBaseUrl();

  if (!baseUrl) return null;
  return storedHost ?? fromApiBaseUrl(baseUrl);
}
