import ConnectToHost from "@/components/home/connect-to-host";
import { css } from "@/styled/css";
import { Divider, Stack } from "@/styled/jsx";
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

/** Tracks `sizes.panel.form`, like the organigram detail column. */
const column = css({ w: "full", maxW: "[token(sizes.panel.form)]", gap: "6" });

export default function ServerScreen() {
  return (
    <Stack className={panel}>
      <Stack className={column}>
        <ConnectionStatusCard />
        <Divider color="[token(colors.brand.secondary)]" />
        <ConnectToHost />
      </Stack>
    </Stack>
  );
}
