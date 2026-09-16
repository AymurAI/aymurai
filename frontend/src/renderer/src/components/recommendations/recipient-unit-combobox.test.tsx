import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrganigramCandidate } from "@/types/dataExtraction";
import { RecipientUnitCombobox } from "./recipient-unit-combobox";

const CANDIDATES: OrganigramCandidate[] = [
  {
    unit_id: "u1",
    unit_name: "Secretaría de Gobierno y Vínculo Ciudadano",
    sector_id: "s1",
    sector_name: "GCBA",
    ruta_organigrama: "Jefatura de Gabinete › Secretaría de Gobierno",
    score: 87.6,
  },
  {
    unit_id: "u2",
    unit_name: "Dirección General Obras en Vías Peatonales",
    sector_id: "s2",
    sector_name: "GCBA",
    ruta_organigrama: "Ministerio de Espacio Público › DGTAL",
    score: 42.1,
  },
];

// Reassignable per-test so the loading/error tests below can control what
// `listUnits()`'s `queryFn` does without a separate `vi.mock` per case --
// the closure is only invoked at render time, same as `FULL_CORPUS`'s
// forward reference below.
let listUnitsQueryFn: () => Promise<unknown> = () =>
  Promise.resolve(FULL_CORPUS);
let createUnitMutationFn: (input: { name: string }) => Promise<unknown> = (
  input,
) =>
  Promise.resolve({
    id: "new-unit-id",
    parent_id: null,
    name: input.name,
    acronym: null,
    short_name: null,
    is_sector: false,
    active: true,
    order: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
  });

afterEach(() => {
  listUnitsQueryFn = () => Promise.resolve(FULL_CORPUS);
  createUnitMutationFn = (input) =>
    Promise.resolve({
      id: "new-unit-id",
      parent_id: null,
      name: input.name,
      acronym: null,
      short_name: null,
      is_sector: false,
      active: true,
      order: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: null,
    });
});

vi.mock("@/services/aymurai/organigram", () => ({
  listUnits: () => ({
    queryKey: ["organigram-units"],
    queryFn: () => listUnitsQueryFn(),
  }),
  createUnit: () => ({
    mutationFn: async (input: { name: string }) => createUnitMutationFn(input),
  }),
}));

const FULL_CORPUS = [
  {
    id: "u9",
    parent_id: null,
    name: "Dirección General de Custodios",
    acronym: "DGC",
    short_name: null,
    is_sector: false,
    active: true,
    order: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
  },
  {
    id: "u10",
    parent_id: null,
    name: "Ministerio de Desarrollo Humano y Hábitat",
    acronym: null,
    short_name: null,
    is_sector: true,
    active: true,
    order: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
  },
];

function renderWithQueryClient(ui: ReactElement) {
  // `retry: false` -- otherwise a rejected `queryFn` (the error-state test
  // below) retries with backoff under the default `QueryClient` options,
  // making `unitsQuery.isError` slow to become true and the test flaky.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    ),
  };
}

function openCombobox() {
  fireEvent.focus(screen.getByRole("combobox"));
}

describe("RecipientUnitCombobox", () => {
  it("shows the resolved candidate's name as its closed value", () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId="leaf-unit-42"
        sectorId="s1"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox")).toHaveValue(CANDIDATES[0].unit_name);
  });

  it("lists all ranked candidates on focus, with no separate 'Sugerido' tag in the list", () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();

    expect(screen.getByText(CANDIDATES[0].unit_name)).toBeInTheDocument();
    expect(screen.getByText(CANDIDATES[1].unit_name)).toBeInTheDocument();
    // Redundant with being first in the list and with the closed chip
    // (hidden while open, tested separately) -- no in-list tag at all.
    expect(screen.queryByText("Sugerido")).not.toBeInTheDocument();
  });

  it("shows the highest-scored candidate as a clickable violet mark when nothing is selected yet", () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );

    // CANDIDATES[0] has the higher score (87.6 vs 42.1).
    expect(screen.getByText(CANDIDATES[0].unit_name)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("the ranking wins over the backend's own separate resolution, both for the tag and for accepting", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        // Simulates the real-world mismatch: `sector_candidates` ranks a
        // specific office (CANDIDATES[0], the higher score) first, while the
        // backend's coarser auto-resolution separately settled on something
        // else entirely (its ancestor sector, or any other id) -- the
        // ranking must win, not this frozen field.
        suggestion={{ unit_id: "some-other-unit", sector_id: "some-sector" }}
        onChange={onChange}
      />,
    );

    expect(screen.getByText(CANDIDATES[0].unit_name)).toBeInTheDocument();
    fireEvent.click(screen.getByText(CANDIDATES[0].unit_name));

    expect(onChange).toHaveBeenCalledWith({
      unit_id: CANDIDATES[0].unit_id,
      sector_id: CANDIDATES[0].sector_id,
    });
  });

  it("falls back to the backend's own resolution when there is nothing to rank", async () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={[]}
        unitId={null}
        sectorId={null}
        suggestion={{ unit_id: "u9", sector_id: null }}
        onChange={vi.fn()}
      />,
    );

    // "u9" ("Dirección General de Custodios") isn't a candidate, but is in
    // the fetched corpus (`FULL_CORPUS`) -- resolved there once it loads.
    expect(
      await screen.findByText("Dirección General de Custodios"),
    ).toBeInTheDocument();
  });

  it("does not show the suggestion mark once a value is already selected", () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={CANDIDATES[1].unit_id}
        sectorId="s2"
        suggestion={{ unit_id: CANDIDATES[0].unit_id, sector_id: "s1" }}
        onChange={vi.fn()}
      />,
    );

    // The already-selected candidate's name shows as the plain closed
    // value, not the (different) suggested candidate's mark.
    expect(screen.getByRole("combobox")).toHaveValue(CANDIDATES[1].unit_name);
    expect(screen.queryByText(CANDIDATES[0].unit_name)).not.toBeInTheDocument();
  });

  it("typing then erasing back to empty clears the value on close, restoring the suggestion", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={CANDIDATES[1].unit_id}
        sectorId="s2"
        suggestion={{ unit_id: CANDIDATES[0].unit_id, sector_id: "s1" }}
        onChange={onChange}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "algo" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(onChange).toHaveBeenCalledWith({ unit_id: null, sector_id: null });
  });

  it("merely opening and closing again, untouched, does not clear the value", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={CANDIDATES[1].unit_id}
        sectorId="s2"
        onChange={onChange}
      />,
    );
    openCombobox();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows each candidate's organigram path inline, never the score", () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();

    expect(
      screen.getByText(CANDIDATES[0].ruta_organigrama),
    ).toBeInTheDocument();
    expect(screen.queryByText(/87\.6|0\.87/)).not.toBeInTheDocument();
  });

  it("emits both unit_id and sector_id when a ranked candidate is picked", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={onChange}
      />,
    );
    openCombobox();
    fireEvent.click(screen.getByText(CANDIDATES[0].unit_name));

    expect(onChange).toHaveBeenCalledWith({
      unit_id: CANDIDATES[0].unit_id,
      sector_id: CANDIDATES[0].sector_id,
    });
  });

  it("prompts to search when there are no ranked candidates", () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={[]}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();
    expect(
      screen.getByText(/escribí para buscar una unidad/i),
    ).toBeInTheDocument();
  });

  it("switches to a full-corpus search once the person types", async () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "custodios" },
    });

    expect(
      await screen.findByText("Dirección General de Custodios"),
    ).toBeInTheDocument();
    // The ranked candidates are replaced, not merged, once searching.
    expect(screen.queryByText(CANDIDATES[0].unit_name)).not.toBeInTheDocument();
  });

  it("finds an accented unit when the person types without accents", async () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "habitat" },
    });

    expect(
      await screen.findByText("Ministerio de Desarrollo Humano y Hábitat"),
    ).toBeInTheDocument();
  });

  it("still finds it when the person does type the accents", async () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Hábitat" },
    });

    expect(
      await screen.findByText("Ministerio de Desarrollo Humano y Hábitat"),
    ).toBeInTheDocument();
  });

  it("picking a full-corpus match emits its id with a null sector_id", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={onChange}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "custodios" },
    });
    fireEvent.click(await screen.findByText("Dirección General de Custodios"));

    expect(onChange).toHaveBeenCalledWith({ unit_id: "u9", sector_id: null });
  });

  it("offers to create a new unit when nothing matches", async () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "una unidad que no existe" },
    });

    expect(
      await screen.findByRole("button", {
        name: /crear "una unidad que no existe" como nueva unidad/i,
      }),
    ).toBeInTheDocument();
  });

  it("creating a new unit emits its id with a null sector_id", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={onChange}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "una unidad que no existe" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /crear "una unidad que no existe" como nueva unidad/i,
      }),
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        unit_id: "new-unit-id",
        sector_id: null,
      }),
    );
  });

  it("invalidates the units query cache after creating a new unit", async () => {
    const { queryClient } = renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "una unidad que no existe" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /crear "una unidad que no existe" como nueva unidad/i,
      }),
    );

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["organigram-units"] }),
      ),
    );
  });

  it("shows an inline error when creating a new unit fails", async () => {
    createUnitMutationFn = () => Promise.reject(new Error("network error"));
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "una unidad que no existe" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /crear "una unidad que no existe" como nueva unidad/i,
      }),
    );

    expect(
      await screen.findByText(/no se pudo crear la unidad/i),
    ).toBeInTheDocument();
  });

  it("does not offer to create a unit while the corpus is still loading", async () => {
    listUnitsQueryFn = () => new Promise(() => {}); // never resolves
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "una unidad que no existe" },
    });

    expect(
      await screen.findByText(/buscando en el organigrama/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /crear/i }),
    ).not.toBeInTheDocument();
  });

  it("does not offer to create a unit when the corpus fails to load", async () => {
    listUnitsQueryFn = () => Promise.reject(new Error("network error"));
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        sectorId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "una unidad que no existe" },
    });

    expect(
      await screen.findByText(/no se pudo cargar el organigrama/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /crear/i }),
    ).not.toBeInTheDocument();
  });
});
