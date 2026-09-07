import { TooltipProvider } from "@aymurai/ui";
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

// `<RecipientUnitSelect>`'s options carry a `description` (@aymurai/ui's
// `Select`), which wraps each option in a Radix Tooltip -- it throws without
// a `TooltipProvider` ancestor even before the dropdown opens. The app root
// (`app.tsx`) supplies one globally; tests need their own, matching
// `recipient-unit-select.test.tsx`/`how-it-works.test.tsx`.
function renderWithProvider(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const MACRO_SECTOR_OPTIONS: FormOption[] = [
  { value: "GCBA", label: "GCBA", outOfCatalog: false },
];

const CANDIDATES: OrganigramCandidate[] = [
  {
    unit_id: "u1",
    unit_name: "Secretaría de Gobierno y Vínculo Ciudadano",
    sector_id: "s1",
    sector_name: "GCBA",
    ruta_organigrama: "Jefatura de Gabinete › Secretaría de Gobierno",
    score: 87.6,
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
  it("shows the unit selector for a GCBA recipient with candidates", () => {
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient()}
        candidates={CANDIDATES}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    // Two comboboxes: the unit selector plus macro_sector's own `Select`
    // (`Select` has no accessible name -- Task 11's report already flagged
    // it has no `aria-labelledby`/`for` linking its visual label -- so this
    // asserts by count rather than by name).
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("does not show the unit selector for a recipient with no candidates", () => {
    renderWithProvider(
      <RecipientFields
        index={0}
        value={aRecipient()}
        candidates={[]}
        macroSectorOptions={MACRO_SECTOR_OPTIONS}
        onChange={vi.fn()}
      />,
    );

    // The macro_sector `Select` is still its own combobox -- only the unit
    // selector is conditionally absent here, so this asserts there is
    // exactly one combobox left (macro_sector), not zero.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
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
