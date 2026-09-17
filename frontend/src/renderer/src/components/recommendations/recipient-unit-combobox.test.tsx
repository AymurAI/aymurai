import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrganigramCandidate } from "@/types/dataExtraction";
import { RecipientUnitCombobox } from "./recipient-unit-combobox";

// Real shape (ADR-0008): every candidate IS a sector, so `unit_id` and
// `sector_id` hold the same id and `ruta_organigrama` is the sector's own
// path. The unit the cargo actually matched travels in `source_unit_*`, and
// that is what this picker lists and posts.
const CANDIDATES: OrganigramCandidate[] = [
  {
    unit_id: "s1",
    unit_name: "Secretaría de Gobierno y Vínculo Ciudadano",
    sector_id: "s1",
    sector_name: "Secretaría de Gobierno y Vínculo Ciudadano",
    ruta_organigrama: "Jefatura de Gabinete > Secretaría de Gobierno",
    score: 87.6,
    source_unit_id: "u1",
    source_unit_name: "Dirección General de Coordinación",
  },
  {
    unit_id: "s2",
    unit_name: "Ministerio de Espacio Público e Higiene Urbana",
    sector_id: "s2",
    sector_name: "Ministerio de Espacio Público e Higiene Urbana",
    ruta_organigrama: "Jefe de Gobierno > Ministerio de Espacio Público",
    score: 42.1,
    source_unit_id: "u2",
    source_unit_name: "Dirección General Obras en Vías Peatonales",
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
  // The IVC case: an autonomous body is its own sector even though it hangs
  // off a ministry that is also one.
  {
    id: "u11",
    parent_id: "u10",
    name: "Instituto de Vivienda de la Ciudad",
    acronym: "IVC",
    short_name: null,
    is_sector: true,
    active: true,
    order: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
  },
  // The ordinary case: a unit whose sector is an ancestor, not itself.
  {
    id: "u12",
    parent_id: "u10",
    name: "Dirección General de Vivienda",
    acronym: null,
    short_name: null,
    is_sector: false,
    active: true,
    order: 4,
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
  it("shows the unit's name as its closed value, not the sector's", () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId="u1"
        onChange={vi.fn()}
      />,
    );
    // "u1" is CANDIDATES[0]'s `source_unit_id`; its sector, "s1", is what the
    // candidate row itself is named after and must NOT be what shows here.
    expect(screen.getByRole("combobox")).toHaveValue(
      "Dirección General de Coordinación",
    );
    expect(screen.getByRole("combobox")).not.toHaveValue(
      CANDIDATES[0].unit_name,
    );
  });

  it("lists the units the candidates were inferred from, not the sectors", () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();

    expect(
      screen.getByText("Dirección General de Coordinación"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Dirección General Obras en Vías Peatonales"),
    ).toBeInTheDocument();
    // The sector names belong to the other field, not this one.
    expect(screen.queryByText(CANDIDATES[0].unit_name)).not.toBeInTheDocument();
    expect(screen.queryByText("Sugerido")).not.toBeInTheDocument();
  });

  it("degrades to the candidate itself when the backend sends no source unit", () => {
    const olderShape = [
      { ...CANDIDATES[0], source_unit_id: null, source_unit_name: null },
    ];
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={olderShape}
        unitId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();

    // Rather than dropping the row out of the list entirely.
    expect(screen.getByText(CANDIDATES[0].unit_name)).toBeInTheDocument();
  });

  it("suggests the backend's own resolution, not the top of the ranking", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        // The auto-resolve is the system's committed answer: it consults the
        // learned index and applies a threshold. The ranking is a list of
        // alternatives with no threshold at all, so it must not override it
        // -- even though CANDIDATES[0] scores higher than anything here.
        suggestion={{ unit_id: "u12", sector_id: "u10" }}
        onChange={onChange}
      />,
    );

    // The suggested unit is not a candidate, so its name is resolved from the
    // corpus once `listUnits()` settles.
    fireEvent.click(await screen.findByText("Dirección General de Vivienda"));

    expect(onChange).toHaveBeenCalledWith({
      unit_id: "u12",
      sector_id: "u10",
    });
  });

  it("falls back to the best-scoring row when the auto-resolve came back empty", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        onChange={onChange}
      />,
    );

    // CANDIDATES[0] scores higher (87.6 vs 42.1), so its source unit stands
    // in as the starting point.
    fireEvent.click(screen.getByText("Dirección General de Coordinación"));

    expect(onChange).toHaveBeenCalledWith({
      unit_id: "u1",
      sector_id: "s1",
    });
  });

  it("resolves a suggested unit's name from the corpus when it is not a candidate", async () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={[]}
        unitId={null}
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
        unitId="u2"
        suggestion={{ unit_id: "u1", sector_id: "s1" }}
        onChange={vi.fn()}
      />,
    );

    // The already-selected unit's name shows as the plain closed value, not
    // the (different) suggested unit's mark.
    expect(screen.getByRole("combobox")).toHaveValue(
      "Dirección General Obras en Vías Peatonales",
    );
    expect(
      screen.queryByText("Dirección General de Coordinación"),
    ).not.toBeInTheDocument();
  });

  it("typing then erasing back to empty clears the value on close, restoring the suggestion", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId="u2"
        suggestion={{ unit_id: "u1", sector_id: "s1" }}
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
        unitId="u2"
        onChange={onChange}
      />,
    );
    openCombobox();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to the candidate's sector path while the unit is not in the corpus", () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();

    // "u1" is not in `FULL_CORPUS`, so its own path cannot be walked -- the
    // row falls back to the sector path the backend sent rather than blank.
    expect(
      screen.getByText(CANDIDATES[0].ruta_organigrama),
    ).toBeInTheDocument();
    expect(screen.queryByText(/87\.6|0\.87/)).not.toBeInTheDocument();
  });

  it("walks the unit's own path from the corpus when it is there", async () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={[
          {
            ...CANDIDATES[0],
            source_unit_id: "u12",
            source_unit_name: "Dirección General de Vivienda",
          },
        ]}
        unitId={null}
        onChange={vi.fn()}
      />,
    );
    openCombobox();

    // The unit's own chain, not the sector path the candidate carries.
    expect(
      await screen.findByText(
        "Ministerio de Desarrollo Humano y Hábitat > Dirección General de Vivienda",
      ),
    ).toBeInTheDocument();
  });

  it("emits both unit_id and sector_id when a ranked candidate is picked", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        onChange={onChange}
      />,
    );
    openCombobox();
    fireEvent.click(screen.getByText("Dirección General de Coordinación"));

    // The regression this whole change is about: `unit_id` must be the unit
    // the cargo matched (`source_unit_id`), NOT the candidate's own id --
    // which is the sector's, and posting it put the same value in both
    // columns.
    expect(onChange).toHaveBeenCalledWith({
      unit_id: "u1",
      sector_id: "s1",
    });
    expect(onChange).not.toHaveBeenCalledWith({
      unit_id: CANDIDATES[0].unit_id,
      sector_id: CANDIDATES[0].sector_id,
    });
  });

  it("prompts to search when there are no ranked candidates", () => {
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={[]}
        unitId={null}
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

  // Picks made through the free search have no candidate to read the sector
  // off, so the sector is walked over the corpus exactly as the server walks
  // it. Until now these posted `sector_id: null`, which blanks SECTOR_FINAL
  // in the export.
  it("derives the sector when picking a unit whose sector is an ancestor", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        onChange={onChange}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "vivienda" },
    });
    fireEvent.click(await screen.findByText("Dirección General de Vivienda"));

    expect(onChange).toHaveBeenCalledWith({ unit_id: "u12", sector_id: "u10" });
  });

  // The IVC case: an autonomous body is its own sector, so both ids are the
  // same id -- legitimately this time, unlike the bug this change fixes.
  it("derives a self-sector unit to itself", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
        onChange={onChange}
      />,
    );
    openCombobox();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "instituto de vivienda" },
    });
    fireEvent.click(
      await screen.findByText("Instituto de Vivienda de la Ciudad"),
    );

    expect(onChange).toHaveBeenCalledWith({ unit_id: "u11", sector_id: "u11" });
  });

  it("emits a null sector for a unit that has no sector ancestor at all", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <RecipientUnitCombobox
        candidates={CANDIDATES}
        unitId={null}
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
