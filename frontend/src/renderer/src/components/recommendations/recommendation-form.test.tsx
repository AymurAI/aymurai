import { TooltipProvider } from "@aymurai/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  DataExtractionPrediction,
  OrganigramCandidate,
} from "@/types/dataExtraction";
import RecommendationForm from "./recommendation-form";

// A selected recipient with non-empty `sector_candidates` mounts
// `<RecipientUnitSelect>`'s `Select`, whose option `description` (Task 12)
// wraps each option in a Radix Tooltip -- it throws without a
// `TooltipProvider` ancestor even before the dropdown opens, the same
// wrapping `app.tsx` does for real, matching `recipient-unit-select.test.tsx`/
// `recipient-fields.test.tsx`'s identical need.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Radix Tooltip's positioning measures the trigger's size via
// ResizeObserver, which jsdom doesn't implement -- stubbed the same way
// `turn-side-panel.test.tsx`/`recipient-unit-select.test.tsx` already do for
// the identical underlying reason.
vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// A small fixture that does NOT contain "Tema inexistente" — matching
// `taxonomy-screen.test.tsx`'s convention of mocking the whole catalogs
// service module rather than driving `api` directly.
vi.mock("@/services/aymurai/catalogs", () => ({
  listTopics: () => ({
    queryKey: ["topics"],
    queryFn: async () => [
      {
        id: "t1",
        code: null,
        name: "Salud",
        active: true,
        order: 1,
        created_at: "x",
        updated_at: "x",
      },
    ],
  }),
  listSubtopics: (topicId: string) => ({
    queryKey: ["subtopics", topicId],
    queryFn: async () => [],
  }),
  listMacroSectors: () => ({
    queryKey: ["macro-sectors"],
    queryFn: async () => [
      {
        id: "m1",
        code: "GCBA",
        name: "GCBA",
        active: true,
        order: 0,
        created_at: "x",
        updated_at: "x",
      },
    ],
  }),
}));

function aPrediction(
  partial: Partial<DataExtractionPrediction> = {},
): DataExtractionPrediction {
  return {
    document_id: "doc-1",
    recommendation_number: "123/2026",
    recommendation_date: "22 de noviembre",
    recipients: [
      {
        name: "Ana Pérez",
        position: "Directora",
        is_primary: true,
        macro_sector: "GCBA",
        unit_id: null,
        unit_name: null,
        sector_id: null,
        sector_name: null,
        match_method: null,
        sector_candidates: [],
      },
    ],
    topic: "Salud",
    subtopic: null,
    personal_data: null,
    publishable_content: "Contenido publicable.",
    config: { model: "m", options: {}, catalogs_hash: "hash" },
    catalogs_stale: false,
    ...partial,
  };
}

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

const A_CANDIDATE: OrganigramCandidate = {
  unit_id: "u1",
  unit_name: "Secretaría de Gobierno y Vínculo Ciudadano",
  sector_id: "s1",
  sector_name: "GCBA",
  ruta_organigrama: "Jefatura de Gabinete › Secretaría de Gobierno",
  score: 87.6,
};

describe("RecommendationForm", () => {
  it("renders an out-of-catalog topic as the selected option, with its error inline", () => {
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction({ topic: "Tema inexistente" })}
        validation={null}
      />,
    );

    // §keep-and-flag: never silently dropped — shown as the selected value
    // (`@aymurai/ui`'s `Select` renders the matching option's text inside the
    // combobox; getting a hit here means the hook actually added it as an
    // extra option, not just left `values.topic` untouched)...
    expect(screen.getByText("Tema inexistente")).toBeInTheDocument();
    // ...and flagged with the inline error message.
    expect(
      screen.getByText("validation.topicOutOfCatalog"),
    ).toBeInTheDocument();
  });

  it("starts personal_data's radios unmarked when the value is null", () => {
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction({ personal_data: null })}
        validation={null}
      />,
    );

    expect(
      screen.getByRole("radio", { name: "validation.personalDataYes" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: "validation.personalDataNo" }),
    ).not.toBeChecked();
  });

  // Task 12 built `<RecipientUnitSelect>`/`<RecipientFields>` but, per its
  // own file list, never wired them into this form -- this fix round closes
  // that gap. These two mirror `recipient-fields.test.tsx`'s identical
  // "shows the selector with candidates / hides it without" tests, but here
  // confirming the *integration*: that `RecommendationForm` actually
  // threads the selected recipient's `sector_candidates` down, rather than
  // re-testing `RecipientUnitSelect`'s own null-on-empty logic again.
  it("shows the organigram unit selector when the selected recipient has sector_candidates", () => {
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction({
          recipients: [
            {
              name: "Ana Pérez",
              position: "Directora",
              is_primary: true,
              macro_sector: "GCBA",
              unit_id: null,
              unit_name: null,
              sector_id: null,
              sector_name: null,
              match_method: null,
              sector_candidates: [A_CANDIDATE],
            },
          ],
        })}
        validation={null}
      />,
    );

    // Baseline (no candidates) is 3 comboboxes: macro_sector, topic,
    // subtopic -- see the next test. One more here is the unit selector.
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
  });

  it("does not show the organigram unit selector when the selected recipient has no candidates", () => {
    renderWithClient(
      <RecommendationForm prediction={aPrediction()} validation={null} />,
    );

    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });
});
