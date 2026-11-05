import { TooltipProvider } from "@aymurai/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FormOption,
  OrganigramCandidate,
  RecipientFormValues,
} from "@/types/dataExtraction";
import { RecipientFields } from "./recipient-fields";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Reassignable so the sector-consistency tests can hand the rule a real tree
// -- with an empty corpus `hasSectorMismatch` deliberately reports nothing,
// since it only flags a mismatch it can prove.
let corpus: unknown[] = [];

vi.mock("@/services/aymurai/organigram", () => ({
  listUnits: () => ({
    queryKey: ["organigram-units"],
    queryFn: async () => corpus,
  }),
  createUnit: () => ({
    mutationFn: async (input: { name: string }) => ({
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
    }),
  }),
}));

// `macro_sector`'s own `Select` (@aymurai/ui) wraps its option descriptions
// in a Radix Tooltip, which throws without a `TooltipProvider` ancestor even
// before the dropdown opens. The app root (`app.tsx`) supplies one globally;
// tests need their own, matching `how-it-works.test.tsx`. `RecipientFields`
// also renders `<RecipientUnitCombobox>` for a GCBA recipient, which calls
// `useQuery`/`useMutation` unconditionally (the full-corpus search +
// create-unit affordance), so every render here also needs a
// `QueryClientProvider` ancestor.
function withProviders(queryClient: QueryClient, ui: ReactElement) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>
  );
}

function renderWithProvider(ui: ReactElement) {
  const queryClient = new QueryClient();
  const result = render(withProviders(queryClient, ui));
  return {
    ...result,
    // `rerender` re-renders whatever tree it's given at the existing root --
    // it does not reapply `renderWithProvider`'s wrapping, so a bare
    // `rerender(<Foo />)` would drop the `QueryClientProvider` ancestor
    // `RecipientUnitSelect` needs. Rewrap here so callers can keep passing
    // just the next tree, the same shape as the original `render` call.
    rerender: (nextUi: ReactElement) =>
      result.rerender(withProviders(queryClient, nextUi)),
  };
}

const MACRO_SECTOR_OPTIONS: FormOption[] = [
  { value: "GCBA", label: "GCBA", outOfCatalog: false },
];

// A candidate IS a sector (ADR-0008): `unit_id === sector_id`, and the unit
// the cargo matched travels in `source_unit_*`.
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
];

function aRecipient(
  partial: Partial<RecipientFormValues> = {},
): RecipientFormValues {
  return {
    id: null,
    source_index: 0,
    name: "Ana Pérez",
    position: "Directora",
    is_primary: false,
    macro_sector: "GCBA",
    unit_id: null,
    sector_id: null,
    ...partial,
  };
}

describe("RecipientFields", () => {
  it("shows the unit combobox for a GCBA recipient with candidates", () => {
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient()}
        candidates={CANDIDATES}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    // Three comboboxes: the unit and sector pickers plus macro_sector's own
    // `Select` (`Select` has no accessible name -- Task 11's report already
    // flagged it has no `aria-labelledby`/`for` linking its visual label --
    // so this asserts by count rather than by name).
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("still shows both organigram fields for a GCBA recipient with no candidates", () => {
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient()}
        candidates={[]}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    // Unlike the historical `RecipientUnitSelect` (gated on candidates.length
    // > 0), both pickers always render for a GCBA recipient -- an empty
    // ranked list just falls back to its search-to-find prompt.
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("hides the unit combobox entirely for a non-GCBA recipient", () => {
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient({ macro_sector: "Organismos Nacionales" })}
        candidates={[]}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    // The macro_sector `Select` is still its own combobox -- only the unit
    // combobox is conditionally absent here, so this asserts there is
    // exactly one combobox left (macro_sector), not zero.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("threads the suggested unit through to the unit combobox", () => {
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient({ unit_id: null, sector_id: null })}
        suggestion={aRecipient({
          unit_id: CANDIDATES[0].source_unit_id,
          sector_id: CANDIDATES[0].sector_id,
        })}
        candidates={CANDIDATES}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    // Each field suggests its own half of the pair: the unit the cargo
    // pointed at, and the sector that contains it.
    expect(
      screen.getByText("Dirección General de Coordinación"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(CANDIDATES[0].sector_name as string),
    ).toBeInTheDocument();
  });

  // `ministerio` [sector] > `direccion`; `otro` [sector] is somewhere else.
  const TREE = [
    {
      id: "ministerio",
      parent_id: null,
      name: "Ministerio de Desarrollo Humano y Hábitat",
      acronym: null,
      short_name: null,
      is_sector: true,
      active: true,
      order: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: null,
    },
    {
      id: "direccion",
      parent_id: "ministerio",
      name: "Dirección General de Vivienda",
      acronym: null,
      short_name: null,
      is_sector: false,
      active: true,
      order: 2,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: null,
    },
    {
      id: "otro",
      parent_id: null,
      name: "Ministerio de Justicia",
      acronym: null,
      short_name: null,
      is_sector: true,
      active: true,
      order: 3,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: null,
    },
  ];

  afterEach(() => {
    corpus = [];
  });

  it("warns when a hand-validated sector does not contain the unit", async () => {
    corpus = TREE;
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient({ unit_id: "direccion", sector_id: "otro" })}
        candidates={[]}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("validation.sectorMismatch"),
    ).toBeInTheDocument();
  });

  it("stays quiet when the unit belongs to the sector", async () => {
    corpus = TREE;
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient({ unit_id: "direccion", sector_id: "ministerio" })}
        candidates={[]}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    // Let the corpus settle before concluding the warning is absent -- the
    // unit's name only resolves once `listUnits()` lands.
    await waitFor(() =>
      expect(screen.getByLabelText("validation.unit")).toHaveValue(
        "Dirección General de Vivienda",
      ),
    );
    expect(
      screen.queryByText("validation.sectorMismatch"),
    ).not.toBeInTheDocument();
  });

  // The QA finding: with a sector validated, the unit field was still
  // offering units of other ministries that merely looked similar.
  it("offers only the sector's own units once a sector is set", async () => {
    corpus = TREE;
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient({ unit_id: "direccion", sector_id: "ministerio" })}
        candidates={CANDIDATES}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("validation.unit")).toHaveValue(
        "Dirección General de Vivienda",
      ),
    );

    fireEvent.focus(screen.getByLabelText("validation.unit"));

    expect(
      await screen.findByText("Ministerio de Desarrollo Humano y Hábitat"),
    ).toBeVisible();
    // Belongs to the other ministry, so it is not on offer at all.
    expect(
      screen.queryByText("Ministerio de Justicia"),
    ).not.toBeInTheDocument();
  });

  it("keeps the backend's similarity order among the sector's ranked units", async () => {
    corpus = TREE;
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient({ unit_id: "direccion", sector_id: "ministerio" })}
        candidates={CANDIDATES}
        // Deliberately the weaker match first: the order must come from the
        // scores the backend computed, not from the array or the tree.
        unitCandidates={[
          {
            unit_id: "ministerio",
            unit_name: "Ministerio de Desarrollo Humano y Hábitat",
            sector_id: "ministerio",
            sector_name: "Ministerio de Desarrollo Humano y Hábitat",
            ruta_organigrama: "Ministerio de Desarrollo Humano y Hábitat",
            score: 91.0,
          },
          {
            unit_id: "direccion",
            unit_name: "Dirección General de Vivienda",
            sector_id: "ministerio",
            sector_name: "Ministerio de Desarrollo Humano y Hábitat",
            ruta_organigrama:
              "Ministerio de Desarrollo Humano y Hábitat > Dirección General de Vivienda",
            score: 44.0,
          },
        ]}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("validation.unit")).toHaveValue(
        "Dirección General de Vivienda",
      ),
    );

    fireEvent.focus(screen.getByLabelText("validation.unit"));

    const rows = await screen.findAllByRole("button");
    const names = rows.map((row) => row.textContent ?? "");
    const ministerio = names.findIndex((n) =>
      n.startsWith("Ministerio de Desarrollo Humano y Hábitat"),
    );
    const direccion = names.findIndex((n) =>
      n.startsWith("Dirección General de Vivienda"),
    );
    expect(ministerio).toBeGreaterThanOrEqual(0);
    expect(direccion).toBeGreaterThan(ministerio);
  });

  it("narrows the unit picker to the pinned sector while the pair disagrees", async () => {
    corpus = TREE;
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient({ unit_id: "direccion", sector_id: "otro" })}
        candidates={[]}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    await screen.findByText("validation.sectorMismatch");

    // Opening the unit picker now offers the pinned sector's own units
    // instead of the cargo's candidates -- "Dirección General de Vivienda"
    // hangs off the other ministry, so it is not on offer.
    fireEvent.focus(screen.getByLabelText("validation.unit"));

    expect(await screen.findByText("Ministerio de Justicia")).toBeVisible();
    expect(
      screen.queryByText("Dirección General de Vivienda"),
    ).not.toBeInTheDocument();
  });

  it("marking two recipients as primary leaves both marked", () => {
    const onChangeA = vi.fn();
    const onChangeB = vi.fn();

    const { rerender } = renderWithProvider(
      <>
        <RecipientFields
          index={0}
          value={aRecipient({ is_primary: false })}
          candidates={[]}
          macroSectorOptions={MACRO_SECTOR_OPTIONS}
          onChange={onChangeA}
        />
        <RecipientFields
          index={1}
          value={aRecipient({ is_primary: false })}
          candidates={[]}
          macroSectorOptions={MACRO_SECTOR_OPTIONS}
          onChange={onChangeB}
        />
      </>,
    );

    const yesRadios = screen.getAllByRole("radio", {
      name: "validation.isPrimaryYes",
    });
    expect(yesRadios).toHaveLength(2);

    fireEvent.click(yesRadios[0]);
    fireEvent.click(yesRadios[1]);

    expect(onChangeA).toHaveBeenCalledWith({ is_primary: true });
    expect(onChangeB).toHaveBeenCalledWith({ is_primary: true });

    // Each recipient's `is_primary` lives in its own form-value object
    // (`setRecipient(index, patch)` only ever touches its own index), so
    // marking both principal is admitted -- re-rendering with both flipped
    // to `true` must leave both radios checked, not exclusive like a single
    // shared native radio group would.
    rerender(
      <>
        <RecipientFields
          index={0}
          value={aRecipient({ is_primary: true })}
          candidates={[]}
          macroSectorOptions={MACRO_SECTOR_OPTIONS}
          onChange={onChangeA}
        />
        <RecipientFields
          index={1}
          value={aRecipient({ is_primary: true })}
          candidates={[]}
          macroSectorOptions={MACRO_SECTOR_OPTIONS}
          onChange={onChangeB}
        />
      </>,
    );

    for (const radio of screen.getAllByRole("radio", {
      name: "validation.isPrimaryYes",
    })) {
      expect(radio).toBeChecked();
    }
  });
  it("offers the macro sector as a clickable suggestion while it is still blank", () => {
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient({ macro_sector: null })}
        suggestion={aRecipient({ macro_sector: "GCBA" })}
        candidates={[]}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "GCBA" })).toBeInTheDocument();
  });

  it("shows the organigram fields while the macro sector is only suggested", () => {
    // Gating them on the VALIDATED ámbito would hide them until that one
    // mark was clicked -- an ordering the form imposes nowhere else.
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient({ macro_sector: null })}
        suggestion={aRecipient({ macro_sector: "GCBA" })}
        candidates={CANDIDATES}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("hides them again once a non-GCBA macro sector is validated over a GCBA suggestion", () => {
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient({ macro_sector: "Organismos Nacionales" })}
        suggestion={aRecipient({ macro_sector: "GCBA" })}
        candidates={CANDIDATES}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });
});
