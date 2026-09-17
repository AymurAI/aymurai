import { queryOptions } from "@tanstack/react-query";
import z from "zod";
import api from "../api";

const healthcheckSchema = z.object({ status: z.string() });

/**
 * Liveness probe against the server the client is currently pointed at.
 *
 * `useConnectToHost` probes a host the app is *not* on yet; this one reports
 * whether the configured server is answering right now, which is what lets the
 * Configuración screen tell "the app is broken" apart from "the server is
 * down". Keyed on the base URL so switching servers starts a fresh probe, and
 * never retried — a failed probe is the answer, not an error to paper over.
 */
export const healthcheck = () =>
  queryOptions({
    queryKey: ["server-healthcheck", api.defaults.baseURL],
    queryFn: async () =>
      healthcheckSchema.parse((await api.get("/server/healthcheck")).data),
    enabled: Boolean(api.defaults.baseURL),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
