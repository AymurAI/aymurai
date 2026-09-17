import { Callout } from "@aymurai/ui";
import { css } from "@/styled/css";
import { Stack, styled } from "@/styled/jsx";

/**
 * The "nothing selected yet" surface for a detail pane. Both Configuración
 * screens render this same element so the prompt sits in exactly the same
 * place on each — the panels around it differ (one carries a heading, the
 * other doesn't), which is why centring inside each panel's own content box
 * put the two callouts at different heights.
 */
const surface = css({
  bg: "bg.primary",
  border: "card",
  borderRadius: "lg",
  p: "6",
  flex: "1",
  minH: "0",
  minW: "0",
  alignItems: "center",
  justifyContent: "center",
});

interface EmptySelectionProps {
  message: string;
}

export default function EmptySelection({ message }: EmptySelectionProps) {
  return (
    <Stack className={surface}>
      <styled.div w="full" maxW="[480px]">
        <Callout variant="info" message={message} />
      </styled.div>
    </Stack>
  );
}
