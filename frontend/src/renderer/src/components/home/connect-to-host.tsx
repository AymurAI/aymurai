import { Button, TextField } from "@aymurai/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AxiosError } from "axios";
import {
  type ChangeEventHandler,
  type SubmitEventHandler,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ZodError } from "zod";
import { showToast } from "@/features/showToast";
import { useConnectedHost } from "@/hooks/useConnectedHost";
import { resetApiBaseUrl } from "@/services/api";
import { normalizeServerHost } from "@/services/api-base-url";
import { useConnectToHost } from "@/services/aymurai";
import * as localStore from "@/store/useLocal";
import { css } from "@/styled/css";
import { HStack, Stack, styled } from "@/styled/jsx";
import { isElectronApp } from "@/utils/app-mode";

export default function ConnectToHost() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const defaultHost = isElectronApp() ? "" : window.location.origin;
  const storedHost = localStore.useServerHost();
  const remoteHost = storedHost ?? defaultHost;
  const { setServerHost, clearServerHost } = localStore.useServerHostActions();
  const { t } = useTranslation();
  const { t: settingsT } = useTranslation("settings");
  const connectedHost = useConnectedHost();

  const [host, setHost] = useState(remoteHost);

  const { mutate: connectToHost, isPending, error, reset } = useConnectToHost();

  const handleChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setHost(e.target.value);
    reset();
  };

  const tryConnection: SubmitEventHandler = (e) => {
    e.preventDefault();

    connectToHost(host, {
      onSuccess: () => {
        // Store the canonical base URL, not the raw input, so the field shows
        // the same value it will show after a reload.
        setServerHost(normalizeServerHost(host));
        navigate({
          to: "/home/features",
        });
      },
      onError: (err) => {
        // Log once, when the error actually occurs — errorMessage below is
        // called on every render while an error is displayed, so logging
        // there would re-log on each re-render instead of once per failure.
        console.error(err);
      },
    });
  };

  // Clearing the saved host is not the same as ending up unconfigured: the web
  // app falls back to its own origin. `resetApiBaseUrl` re-runs that
  // precedence, and the field follows wherever the client actually lands.
  const disconnect = () => {
    clearServerHost();
    resetApiBaseUrl();
    reset();
    setHost(isElectronApp() ? "" : window.location.origin);
    queryClient.invalidateQueries();
    showToast(settingsT("server.disconnectedToast"), "success");
  };

  const errorMessage = (err: Error | null): string => {
    if (err instanceof AxiosError) {
      if (err.code === "ERR_NETWORK") return t("home.host.errors.network");
      return t("home.host.errors.connection");
    }

    if (err instanceof ZodError) {
      return t("home.host.errors.invalidResponse");
    }

    if (err instanceof TypeError) {
      return t("home.host.errors.invalidUrl");
    }

    return t("home.host.errors.unknown");
  };

  return (
    <form onSubmit={tryConnection} className={css({ width: "full" })}>
      <Stack justify="center" gap="4" width="full">
        <styled.h2 textStyle="subtitle.md.strong">
          {t("home.host.connectServerExplanation")}
        </styled.h2>

        <TextField
          label={t("home.host.connectServerLabel")}
          placeholder="http://"
          value={host}
          onChange={handleChange}
          error={error ? errorMessage(error) : undefined}
        />

        <HStack gap="2">
          <Button type="submit" isLoading={isPending}>
            {connectedHost
              ? settingsT("server.reconnectSubmit")
              : t("home.host.connectServerSubmit")}
          </Button>
          {/* Only offered when there is a saved host to forget. The web app
              with nothing stored is on its own origin, which is not something
              a user can disconnect from. */}
          {storedHost !== null && (
            <Button type="button" variant="secondary" onClick={disconnect}>
              {settingsT("server.disconnectAction")}
            </Button>
          )}
        </HStack>
      </Stack>
    </form>
  );
}
