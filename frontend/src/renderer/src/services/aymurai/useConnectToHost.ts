import { useMutation } from "@tanstack/react-query";
import z from "zod";
import api, { setApiBaseUrl } from "@/services/api";
import { toApiBaseUrl } from "@/services/api-base-url";

export const useConnectToHost = () => {
  return useMutation({
    mutationKey: ["healthcheck"],
    // The probe uses an absolute URL so it does not depend on the client's
    // current baseURL — the whole point is to test a host we are not on yet.
    mutationFn: async (host: string) => {
      const response = await api
        .get(`${toApiBaseUrl(host)}/server/healthcheck`)
        .then((r) => r.data);

      return z.object({ status: z.string() }).parse(response);
    },
    onSuccess: (_data, host) => {
      setApiBaseUrl(host);
    },
  });
};
