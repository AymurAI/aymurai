import AppCredits from "@/components/brand/app-credits";
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

/**
 * The credit block lands on the same baseline as its counterpart on the
 * features home, so navigating between the two does not shift it.
 *
 * Both are viewport-height independent — features' sits in content flow under
 * a fixed-height card grid, and everything above this one (header, title, tab
 * row, form) is fixed too — so a constant offset holds them level at any
 * window size. It is measured, not derived: 151px puts this one at the 728px
 * its counterpart occupies, on top of the panel's own 24px gap. Re-measure if
 * the features grid gains a row or this form gains a field; a validation
 * error under the address field drops it by that message's height, which is
 * the one case the two screens disagree.
 */
const credits = css({ pt: "[151px]" });

export default function ServerScreen() {
  return (
    <Stack className={panel}>
      <Stack className={column}>
        <ConnectionStatusCard />
        <Divider color="[token(colors.brand.secondary)]" />
        <ConnectToHost />
      </Stack>
      <AppCredits className={credits} />
    </Stack>
  );
}
