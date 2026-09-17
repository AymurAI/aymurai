import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Radio from "../radio";
import RadioGroup from "./index";

describe("RadioGroup", () => {
  it("reflects each child's own checked prop, not just the value at first mount", () => {
    const { rerender } = render(
      <RadioGroup name="is-primary-0">
        <Radio checked={true} onChange={vi.fn()}>
          Sí
        </Radio>
        <Radio checked={false} onChange={vi.fn()}>
          No
        </Radio>
      </RadioGroup>,
    );
    expect(screen.getByRole("radio", { name: "Sí" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "No" })).not.toBeChecked();

    // Same tree position, re-rendered with a DIFFERENT recipient's/decision's
    // data (as happens switching tabs without remounting) -- the displayed
    // radio must follow the new checked props, not whatever was checked when
    // this component first mounted.
    rerender(
      <RadioGroup name="is-primary-1">
        <Radio checked={false} onChange={vi.fn()}>
          Sí
        </Radio>
        <Radio checked={true} onChange={vi.fn()}>
          No
        </Radio>
      </RadioGroup>,
    );
    expect(screen.getByRole("radio", { name: "Sí" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "No" })).toBeChecked();
  });

  it("calls the clicked radio's own onChange, not a group-level handler", () => {
    const onChangeYes = vi.fn();
    const onChangeNo = vi.fn();
    render(
      <RadioGroup name="is-primary-0">
        <Radio checked={false} onChange={onChangeYes}>
          Sí
        </Radio>
        <Radio checked={true} onChange={onChangeNo}>
          No
        </Radio>
      </RadioGroup>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Sí" }));
    expect(onChangeYes).toHaveBeenCalledWith(true);
    expect(onChangeNo).not.toHaveBeenCalled();
  });

  it("injects the given name onto every radio", () => {
    render(
      <RadioGroup name="tipoAudiencia">
        <Radio checked={false} onChange={vi.fn()}>
          Oral
        </Radio>
        <Radio checked={false} onChange={vi.fn()}>
          Escrita
        </Radio>
      </RadioGroup>,
    );
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("name", "tipoAudiencia");
    }
  });
});
