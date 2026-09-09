import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ValidatedTextField } from "./validated-text-field";

describe("ValidatedTextField", () => {
  it("renders the current value in the input", () => {
    render(
      <ValidatedTextField
        label="Nombre"
        value="Juan"
        suggestion={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Nombre")).toHaveValue("Juan");
  });

  it("still renders the suggestion when it matches the current value", () => {
    // This flow seeds `value` from the same prediction as `suggestion`, so
    // they're equal on first render for every untouched field -- hiding the
    // mark in that case would mean it never appears until the person edits
    // away and back, which is the "suggestions disappeared" bug this guards.
    render(
      <ValidatedTextField
        label="Nombre"
        value="Juan"
        suggestion="Juan"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Juan" })).toBeInTheDocument();
  });

  it("does not render a suggestion slot when there is none", () => {
    render(
      <ValidatedTextField
        label="Nombre"
        value="Juan"
        suggestion={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("clicking the suggestion accepts it as the value", () => {
    const onChange = vi.fn();
    render(
      <ValidatedTextField
        label="Nombre"
        value=""
        suggestion="Juan Pérez"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Juan Pérez" }));
    expect(onChange).toHaveBeenCalledWith("Juan Pérez");
  });

  it("typing in the field calls onChange with the typed value", () => {
    const onChange = vi.fn();
    render(
      <ValidatedTextField
        label="Nombre"
        value=""
        suggestion={null}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Ana" },
    });
    expect(onChange).toHaveBeenCalledWith("Ana");
  });
});
