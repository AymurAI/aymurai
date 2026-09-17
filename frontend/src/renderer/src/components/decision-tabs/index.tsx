import { Plus } from "phosphor-react";
import { useRef } from "react";
import ScrollArea from "@/components/ui/scroll-area";
import { css } from "@/styled/css";
import { Stack } from "@/styled/jsx";
import nArray from "@/utils/nArray";
import { Tab, TabName } from "../tabs";

const button = css({
  cursor: "pointer",
  p: "2",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",

  height: "full",
  width: "12",
  flexShrink: "0",
});

const scrollArea = css({
  flex: "1",
  minW: "0",
});

const tabsRow = css({
  minW: "[max-content]",
  // Radix's horizontal scrollbar overlays the viewport's bottom edge
  // (`position: absolute`, set internally by @radix-ui/react-scroll-area --
  // `ui/scroll-area.tsx` doesn't override it) -- reserve room below the tabs
  // so the scrollbar thumb doesn't sit on top of the button labels.
  pb: "[14px]",
});

interface Props {
  selected: number;
  decisionAmount: number;
  addDecision: () => void;
  selectDecision: (n: number) => void;
  /** Overridable per caller. The legacy `validate-dataset` flow also reuses
   *  this component and does not currently pass a label override -- its own
   *  tests don't assert the "Decisión N" text, so it picks up the new
   *  "Destinatario N" default too, as an acceptable side effect of fixing
   *  this shared component. Pass an explicit `label` to keep old copy. */
  label?: string;
}
export default function DecisionTabs({
  selected,
  decisionAmount,
  addDecision,
  selectDecision,
  label = "Destinatario",
}: Props) {
  const decisionArr = nArray(decisionAmount, undefined).map((_, i) => i);
  const tabRefs = useRef<Array<HTMLElement | null>>([]);

  const selectDecisionHandler = (n: number) => () => {
    selectDecision(n);
    // Bring the clicked tab fully into view -- `scrollIntoView` walks up to
    // the nearest scrollable ancestor (the Radix viewport) on its own, no
    // manual scrollLeft math needed.
    tabRefs.current[n]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  };

  return (
    <Stack direction="row" gap="2" alignItems="center">
      <ScrollArea orientation="horizontal" className={scrollArea}>
        <Stack direction="row" gap="2" className={tabsRow}>
          {decisionArr.map((dec) => (
            <Tab
              key={dec}
              ref={(el: HTMLElement | null) => {
                tabRefs.current[dec] = el;
              }}
              as="button"
              css={{ cursor: "pointer" }}
              onClick={selectDecisionHandler(dec)}
              status={selected === dec ? "focus" : "default"}
            >
              <TabName css={{ cursor: "pointer" }}>
                {label} {dec + 1}
              </TabName>
            </Tab>
          ))}
        </Stack>
      </ScrollArea>
      <button onClick={addDecision} className={button} type="button">
        <Plus size={16} weight="light" />
      </button>
    </Stack>
  );
}
