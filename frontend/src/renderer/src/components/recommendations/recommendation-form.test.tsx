import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DataExtractionPrediction } from "@/types/dataExtraction";
import RecommendationForm from "./recommendation-form";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

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
});
