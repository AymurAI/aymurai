import { TooltipProvider } from "@aymurai/ui";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OrganigramCandidate } from "@/types/dataExtraction";
import { RecipientUnitSelect } from "./recipient-unit-select";

// Radix Tooltip's positioning measures the trigger's size via
// ResizeObserver, which jsdom doesn't implement -- stubbed the same way
// `turn-side-panel.test.tsx` does for the same underlying reason.
vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// `Select`'s option description (@aymurai/ui) renders inside a Radix
// Tooltip, which throws without a `TooltipProvider` ancestor -- the app root
// (`app.tsx`) supplies one globally; tests need their own, matching
// `how-it-works.test.tsx`'s identical wrapping.
function renderWithProvider(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

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

describe("RecipientUnitSelect", () => {
  it("is not rendered when there are no candidates", () => {
    renderWithProvider(
      <RecipientUnitSelect candidates={[]} value={null} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the organigram path as each option's description", async () => {
    vi.useFakeTimers();
    renderWithProvider(
      <RecipientUnitSelect
        candidates={CANDIDATES}
        value={null}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    // `Select`'s description is a Radix Tooltip, hover-triggered after a
    // 700ms delay baked into the library -- open the dropdown, then hover
    // the option to reveal it (never shown on open alone).
    fireEvent.pointerEnter(screen.getByText(CANDIDATES[0].unit_name));
    act(() => {
      vi.advanceTimersByTime(700);
    });
    // Radix Tooltip renders the description twice (a visible bubble plus a
    // visually-hidden accessible copy) -- `role="tooltip"` picks the one
    // that matters rather than tripping over the duplicate text node.
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Jefatura de Gabinete › Secretaría de Gobierno",
    );
    vi.useRealTimers();
  });

  it("never shows the score", async () => {
    renderWithProvider(
      <RecipientUnitSelect
        candidates={CANDIDATES}
        value={null}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByText(/87\.6|0\.87/)).not.toBeInTheDocument();
  });

  it("emits both unit_id and sector_id when an option is picked", async () => {
    const onChange = vi.fn();
    renderWithProvider(
      <RecipientUnitSelect
        candidates={CANDIDATES}
        value={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText(CANDIDATES[0].unit_name));

    expect(onChange).toHaveBeenCalledWith({
      unit_id: CANDIDATES[0].unit_id,
      sector_id: CANDIDATES[0].sector_id,
    });
  });
});
