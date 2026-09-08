import { Plus } from "phosphor-react";
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
});

interface Props {
  selected: number;
  decisionAmount: number;
  addDecision: () => void;
  selectDecision: (n: number) => void;
  /** Overridable per caller -- the legacy `validate-dataset` flow reuses this
   *  same component and keeps its historical "Decisión N" label. */
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

  const selectDecisionHandler = (n: number) => () => selectDecision(n);

  return (
    <Stack direction="row" gap="2" alignItems="center">
      <ScrollArea orientation="horizontal" className={scrollArea}>
        <Stack direction="row" gap="2" className={tabsRow}>
          {decisionArr.map((dec) => (
            <Tab
              key={dec}
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
