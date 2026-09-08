import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ValidatedTextField } from "./validated-text-field";

describe("ValidatedTextField", () => {
  it("renders the current value in the input", () => {
    render(
      <ValidatedTextField label="Nombre" value="Juan" suggestion={null} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("Nombre")).toHaveValue("Juan");
  });

  it("does not render a suggestion when it matches the current value", () => {
    render(
      <ValidatedTextField label="Nombre" value="Juan" suggestion="Juan" onChange={vi.fn()} />,
    );
    expect(screen.queryByText("Juan", { selector: "button" })).not.toBeInTheDocument();
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
      <ValidatedTextField label="Nombre" value="" suggestion={null} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Ana" } });
    expect(onChange).toHaveBeenCalledWith("Ana");
  });
});
