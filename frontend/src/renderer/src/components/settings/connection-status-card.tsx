import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useConnectedHost } from "@/hooks/useConnectedHost";
import { serverService } from "@/services/aymurai";
import { css, cva } from "@/styled/css";
import { HStack, Stack, styled } from "@/styled/jsx";

const card = css({
  bg: "bg.secondary",
  borderRadius: "md",
  px: "4",
  py: "3",
  gap: "1",
  w: "full",
});

type ConnectionState = "connected" | "checking" | "error" | "none";

// A recipe, not a `bg` prop fed from a lookup: Panda extracts styles
// statically, so a computed token value emits the class name without ever
// generating the rule behind it — a dot that is the right size and invisible.
const dot = cva({
  base: {
    w: "2.5",
    h: "2.5",
    borderRadius: "full",
    flexShrink: "0",
  },
  variants: {
    state: {
      connected: { bg: "system.success" },
      checking: { bg: "brand.secondary" },
      error: { bg: "system.error" },
      none: { bg: "action.disabled" },
    },
  },
});

/**
 * Live state of the server the app is pointed at, shown above the address
 * form. It answers what the form cannot: whether the configured server is
 * answering *right now* — the difference between "AymurAI is broken" and "the
 * server is down", which is otherwise only discoverable by opening a feature
 * and watching it fail.
 */
export default function ConnectionStatusCard() {
  const { t } = useTranslation("settings");
  const host = useConnectedHost();
  const { isSuccess, isError, isFetching } = useQuery(
    serverService.healthcheck(),
  );

  // `isFetching` wins over the previous verdict: while a re-probe is in flight
  // the card should not keep asserting a state it is currently re-checking.
  const state: ConnectionState = !host
    ? "none"
    : isFetching
      ? "checking"
      : isError
        ? "error"
        : isSuccess
          ? "connected"
          : "checking";

  // The host is the useful detail whenever there is one; with no host there is
  // nothing to name, so the card says what to do instead.
  const detail =
    state === "error"
      ? t("server.status.errorDetail")
      : (host ?? t("server.status.noneDetail"));

  return (
    <Stack className={card} data-testid="connection-status" data-state={state}>
      <styled.p textStyle="subtitle.sm.default" color="text.lighter">
        {t("server.status.label")}
      </styled.p>
      <HStack gap="2">
        <styled.span className={dot({ state })} aria-hidden="true" />
        <styled.span textStyle="label.md.strong" color="text.default">
          {t(`server.status.${state}`)}
        </styled.span>
      </HStack>
      <styled.p
        textStyle="subtitle.sm.default"
        color="text.lighter"
        overflowWrap="anywhere"
      >
        {detail}
      </styled.p>
    </Stack>
  );
}
