import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ValidatedDateField } from "./validated-date-field";

describe("ValidatedDateField", () => {
  it("renders the current value in the date input", () => {
    render(
      <ValidatedDateField
        label="Fecha"
        value="2026-11-22"
        suggestion={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-11-22");
  });

  it("does not render the suggestion once the field already has a value", () => {
    // Same gating as `ValidatedTextField`: once `value` is set (accepted, or
    // picked directly from the calendar), the suggestion mark has nothing
    // left to offer.
    render(
      <ValidatedDateField
        label="Fecha"
        value="2026-11-22"
        suggestion="2026-11-22"
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "22/11/2026" }),
    ).not.toBeInTheDocument();
  });

  it("renders the suggestion, formatted as dd/mm/aaaa, while the field is still empty", () => {
    render(
      <ValidatedDateField
        label="Fecha"
        value=""
        suggestion="2026-11-22"
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "22/11/2026" }),
    ).toBeInTheDocument();
  });

  it("does not render a suggestion slot when there is none", () => {
    render(
      <ValidatedDateField
        label="Fecha"
        value=""
        suggestion={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("clicking the suggestion accepts the raw ISO date as the value, not the display text", () => {
    const onChange = vi.fn();
    render(
      <ValidatedDateField
        label="Fecha"
        value=""
        suggestion="2026-11-22"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "22/11/2026" }));
    expect(onChange).toHaveBeenCalledWith("2026-11-22");
  });

  it("forwards extra DOM props (e.g. onFocus) onto the native input, for Radix's asChild triggers", () => {
    // `recommendation-form.tsx` wraps this field in `TooltipTrigger asChild`
    // when there's raw prose to show on hover -- Radix's `Slot` clones the
    // single child element it's given and merges its own onFocus/
    // onPointerEnter/ref onto it. Since that child is `<ValidatedDateField>`
    // itself (a plain component, not a DOM node), those props only reach a
    // real element if this component explicitly forwards them, the same way
    // `@aymurai/ui`'s `TextField` does.
    const onFocus = vi.fn();
    render(
      <ValidatedDateField
        label="Fecha"
        value=""
        suggestion={null}
        onChange={vi.fn()}
        onFocus={onFocus}
      />,
    );
    fireEvent.focus(screen.getByLabelText("Fecha"));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("picking a date via the native calendar calls onChange, bypassing the suggestion", () => {
    const onChange = vi.fn();
    render(
      <ValidatedDateField
        label="Fecha"
        value=""
        suggestion="2026-11-22"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Fecha"), {
      target: { value: "2026-01-05" },
    });
    expect(onChange).toHaveBeenCalledWith("2026-01-05");
  });
});
