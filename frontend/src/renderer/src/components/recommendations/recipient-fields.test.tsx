import { TooltipProvider } from "@aymurai/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  FormOption,
  OrganigramCandidate,
  RecipientFormValues,
} from "@/types/dataExtraction";
import { RecipientFields } from "./recipient-fields";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services/aymurai/organigram", () => ({
  listUnits: () => ({
    queryKey: ["organigram-units"],
    queryFn: async () => [],
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

    // Two comboboxes: the unit combobox plus macro_sector's own `Select`
    // (`Select` has no accessible name -- Task 11's report already flagged
    // it has no `aria-labelledby`/`for` linking its visual label -- so this
    // asserts by count rather than by name).
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("still shows the unit combobox for a GCBA recipient with no candidates", () => {
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
    // > 0), the merged combobox always renders for a GCBA recipient -- an
    // empty ranked list just falls back to its search-to-find prompt.
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
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

    // The suggested UNIT, not the sector the candidate row is named after.
    expect(
      screen.getByText("Dirección General de Coordinación"),
    ).toBeInTheDocument();
    expect(screen.queryByText(CANDIDATES[0].unit_name)).not.toBeInTheDocument();
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
});
