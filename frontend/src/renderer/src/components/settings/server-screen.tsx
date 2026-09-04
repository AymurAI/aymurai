import { useTranslation } from "react-i18next";
import ConnectToHost from "@/components/home/connect-to-host";
import { APP_VERSION } from "@/constants/version";
import { css } from "@/styled/css";
import { Divider, Stack, styled } from "@/styled/jsx";
import ConnectionStatusCard from "./connection-status-card";

/**
 * The grey surface the other two Configuración screens are built from, with a
 * single centred column instead of a master/detail split — the same ground,
 * the same white cards, so switching tabs does not change the furniture.
 */
const panel = css({
  bg: "bg.primary",
  border: "card",
  borderRadius: "lg",
  p: "6",
  gap: "6",
  alignItems: "center",
  overflowY: "auto",
  flex: "1",
  minH: "0",
  minW: "0",
});

/**
 * Tracks `sizes.panel.form`, like the organigram detail column. `my: auto`
 * rather than `justifyContent: center` on the panel: auto margins centre the
 * column while there is room to spare and collapse to zero when there is not,
 * so a short viewport scrolls from the top instead of clipping it.
 */
const column = css({
  w: "full",
  maxW: "[token(sizes.panel.form)]",
  gap: "6",
  my: "auto",
});

export default function ServerScreen() {
  const { t } = useTranslation("settings");

  return (
    <Stack className={panel}>
      <Stack className={column}>
        <ConnectionStatusCard />
        <Divider color="[token(colors.brand.secondary)]" />
        <ConnectToHost />
        {/* The install's own version, which support conversations ask for and
            nothing else on screen answers. */}
        <styled.p textStyle="label.sm.default" color="text.lighter">
          {t("server.version", { version: APP_VERSION.replace(/^v/, "") })}
        </styled.p>
      </Stack>
    </Stack>
  );
}
