import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FormOption } from "@/types/dataExtraction";
import { ValidatedSelectField } from "./validated-select-field";

const OPTIONS: FormOption[] = [
  { value: "Salud", label: "Salud", outOfCatalog: false },
  { value: "Ambiente", label: "Ambiente", outOfCatalog: false },
];

const WITH_EXTRA: FormOption[] = [
  ...OPTIONS,
  { value: "Tema inexistente", label: "Tema inexistente", outOfCatalog: true },
];

describe("ValidatedSelectField", () => {
  it("renders the model's guess as a clickable suggestion while the field is blank", () => {
    render(
      <ValidatedSelectField
        label="Tema"
        options={OPTIONS}
        value={null}
        suggestion="Salud"
        outOfCatalogMessage="fuera de catálogo"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Salud" })).toBeInTheDocument();
  });

  it("accepts the suggestion when it is clicked", () => {
    const onChange = vi.fn();
    render(
      <ValidatedSelectField
        label="Tema"
        options={OPTIONS}
        value={null}
        suggestion="Salud"
        outOfCatalogMessage="fuera de catálogo"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Salud" }));

    expect(onChange).toHaveBeenCalledWith("Salud");
  });

  it("stops offering the suggestion once the field has a value", () => {
    render(
      <ValidatedSelectField
        label="Tema"
        options={OPTIONS}
        value="Salud"
        suggestion="Salud"
        outOfCatalogMessage="fuera de catálogo"
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Salud" }),
    ).not.toBeInTheDocument();
  });

  // The whole point of keeping the out-of-catalog extra as an option: an
  // off-catalog suggestion has to be both visible and acceptable, since
  // `Select` resolves the suggestion id against the option list for each.
  it("offers an off-catalog suggestion just like any other", () => {
    const onChange = vi.fn();
    render(
      <ValidatedSelectField
        label="Tema"
        options={WITH_EXTRA}
        value={null}
        suggestion="Tema inexistente"
        outOfCatalogMessage="fuera de catálogo"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tema inexistente" }));

    expect(onChange).toHaveBeenCalledWith("Tema inexistente");
  });

  it("flags an off-catalog suggestion before it is accepted, not only after", () => {
    render(
      <ValidatedSelectField
        label="Tema"
        options={WITH_EXTRA}
        value={null}
        suggestion="Tema inexistente"
        outOfCatalogMessage="fuera de catálogo"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("fuera de catálogo")).toBeInTheDocument();
  });

  it("stays quiet when what is on screen is in the catalog", () => {
    render(
      <ValidatedSelectField
        label="Tema"
        options={WITH_EXTRA}
        value="Salud"
        suggestion="Tema inexistente"
        outOfCatalogMessage="fuera de catálogo"
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("fuera de catálogo")).not.toBeInTheDocument();
  });

  // `Select` (@aymurai/ui) clears its own internal state without calling
  // `onChange`, which would leave the field blank on screen -- suggestion
  // mark and all -- while the form still held, and later saved, the old
  // value. This is the shim that keeps the two in step; if the library ever
  // grows a real clear callback, this test is what says the shim can go.
  it("reports a cleared field as null instead of leaving the old value behind", () => {
    const onChange = vi.fn();
    render(
      <ValidatedSelectField
        label="Tema"
        options={OPTIONS}
        value="Salud"
        suggestion="Ambiente"
        outOfCatalogMessage="fuera de catálogo"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /limpiar/i }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("does not mistake accepting the suggestion for a clear", () => {
    const onChange = vi.fn();
    render(
      <ValidatedSelectField
        label="Tema"
        options={OPTIONS}
        value={null}
        suggestion="Salud"
        outOfCatalogMessage="fuera de catálogo"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Salud" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Salud");
  });
});
