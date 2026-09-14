import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { css } from "@/styled/css";
import type { Props as RadioProps } from "../radio";

const group = css({
  display: "flex",
  gap: "4",
  flexWrap: "wrap",
  borderWidth: "0",
  p: "0",
});

// Matches `@aymurai/ui`'s `TextField`/`Select`/`Textarea` field-label
// convention (`label.sm.default`) -- this used `subtitle.sm.default`, a
// visibly larger/bolder style than every other field label in the same
// form (`personal_data`, `is_primary`).
const legend = css({
  textStyle: "label.sm.default",
  color: "text.lighter",
  mb: "2",
});

interface Props {
  children: ReactNode;
  label?: string;
  name: string;
  direction?: "horizontal" | "vertical";
}

/**
 * A plain grouping/labeling wrapper -- every child `Radio`'s own `checked`/
 * `onChange` stays authoritative; this only injects `name` for native radio
 * grouping. Previously tracked its own `selected` index in state, seeded
 * once from the children's initial `checked` props and never updated after
 * -- every caller in this codebase (`Decision.tsx`, `InfoHecho.tsx`,
 * `recipient-fields.tsx`) already passes a live, per-render `checked` prop
 * to each `Radio`, so that internal state just went stale and silently
 * overrode it: re-rendering the same `RadioGroup` position with a different
 * recipient's/decision's data (switching tabs, never remounting) kept
 * showing whichever radio was checked at first mount, regardless of the new
 * children's actual `checked` props. Confirmed as the cause of "destinatario
 * principal" appearing shared across recipients in the Recomendaciones flow.
 */
export default function RadioGroup({
  label,
  name,
  direction = "horizontal",
  children,
}: Props) {
  const radiosWithName = Children.map(children, (child) => {
    if (isValidElement<RadioProps>(child)) {
      return cloneElement(child as ReactElement<RadioProps>, { name });
    }
    return child;
  });

  return (
    <fieldset
      className={group}
      style={{ flexDirection: direction === "vertical" ? "column" : "row" }}
    >
      {label && <legend className={legend}>{label}</legend>}
      {radiosWithName}
    </fieldset>
  );
}
