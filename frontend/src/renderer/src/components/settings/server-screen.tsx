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

/**
 * Tracks `sizes.panel.form`, like the organigram detail column.
 *
 * The 71px is what drops the submit button's bottom edge onto the bottom of
 * the features home's card grid (y=640 at any window height — both screens
 * are fixed above that point). Lining those two up is what makes the run of
 * space down to the credit read the same on both.
 */
const column = css({
  w: "full",
  maxW: "[token(sizes.panel.form)]",
  gap: "6",
  mt: "[71px]",
});

/**
 * The 88px `routes/home/features.tsx` leaves between its grid and the
 * DataGénero block, minus the 8px this panel actually puts between its own
 * children — Panda's `Stack` pattern ships `gap: 8px` and that wins over the
 * recipe's `gap: "6"` in the generated cascade, so the clearance has to be
 * carried here rather than split with the gap. With the column offset above,
 * the credit lands on the same baseline (y=728) as its counterpart.
 *
 * A validation error under the address field grows the form and pushes this
 * down by that message's height — the one case the two screens disagree.
 */
const credits = css({ pt: "20" });

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
