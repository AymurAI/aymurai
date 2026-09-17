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

  it("does not render the suggestion once the field already has a value", () => {
    // `useRecommendationForm` seeds these fields blank precisely so the
    // model's guess appears ONLY as the suggestion mark, never duplicated
    // as the field's own value too -- once a value exists (typed, or the
    // suggestion already accepted), the mark has nothing left to offer.
    render(
      <ValidatedTextField
        label="Nombre"
        value="Juan"
        suggestion="Juan"
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Juan" }),
    ).not.toBeInTheDocument();
  });

  it("renders the suggestion while the field is still empty", () => {
    render(
      <ValidatedTextField
        label="Nombre"
        value=""
        suggestion="Juan Pérez"
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Juan Pérez" }),
    ).toBeInTheDocument();
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
