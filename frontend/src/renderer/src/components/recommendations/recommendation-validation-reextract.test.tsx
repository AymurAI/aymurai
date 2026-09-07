import { TooltipProvider } from "@aymurai/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { FileContext } from "@/context/File";
import RecommendationProvider, {
  loaded,
  startChecking,
  useRecommendationDispatch,
} from "@/context/Recommendation";
import type { DataExtractionPrediction } from "@/types/dataExtraction";
import type { DocFile } from "@/types/file";
import RecommendationValidation from "./recommendation-validation";

/**
 * Regression coverage for the final-review finding: "Volver a extraer" no
 * actualiza el formulario. `useRecommendationForm` freezes its `values` on
 * first render (`initialRef`) and `<RecommendationForm>` was mounted with no
 * `key`, so a successful re-extraction (`handleReExtract` in
 * `recommendation-validation.tsx`) dispatched a NEW `prediction` into
 * context but the form kept showing the OLD one -- the person saw no visible
 * change, and any `source_index` already in the form silently pointed at the
 * wrong recipient in the new prediction. This suite mounts the REAL
 * `<RecommendationForm>` (not a stand-in like `recommendation-validation.test.tsx`
 * uses for its own, narrower assertions) specifically so a stale `initialRef`
 * would actually surface as a stale field value.
 */

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/layout/header", () => ({
  default: () => <header />,
}));

// The original document panel pulls in `AnnotationProvider`/`ReadingColumn`
// -- irrelevant to this regression, stubbed the same way
// `recommendation-process.test.tsx` stubs unrelated heavy subtrees.
vi.mock("@/components", () => ({
  FileAnnotator: () => <div data-testid="file-annotator" />,
}));

// Radix Tooltip's positioning measures the trigger via ResizeObserver, which
// jsdom doesn't implement -- matches `recommendation-form.test.tsx`'s
// identical stub.
vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// A tiny, closed taxonomy -- matches `recommendation-form.test.tsx`'s own
// convention of mocking the whole catalogs service rather than driving `api`.
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
  listSubtopics: () => ({
    queryKey: ["subtopics"],
    queryFn: async () => [],
  }),
  listMacroSectors: () => ({
    queryKey: ["macro-sectors"],
    queryFn: async () => [],
  }),
}));

const { mockExtract } = vi.hoisted(() => ({ mockExtract: vi.fn() }));

vi.mock("@/services/aymurai/dataExtraction", () => ({
  validateRecommendation: () => ({ mutationFn: vi.fn() }),
  extractDocument: () => ({ mutationFn: mockExtract }),
}));

function aPrediction(
  partial: Partial<DataExtractionPrediction> = {},
): DataExtractionPrediction {
  return {
    document_id: "doc-1",
    recommendation_number: "123/2026",
    recommendation_date: "22 de noviembre",
    recipients: [],
    topic: "Salud",
    subtopic: null,
    personal_data: null,
    publishable_content: "Contenido publicable.",
    config: { model: "m", options: {}, catalogs_hash: "hash-1" },
    catalogs_stale: true,
    ...partial,
  };
}

function SeedPrediction({
  prediction,
  children,
}: {
  prediction: DataExtractionPrediction;
  children: ReactNode;
}) {
  const dispatch = useRecommendationDispatch();
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeds exactly once on mount, matching a real extraction resolving exactly once -- `prediction` is the fixture's initial value and must not re-seed on every render.
  useEffect(() => {
    // `loaded` alone does NOT set `documentId` (only `startChecking` does,
    // see the reducer) -- `handleReExtract` bails out with no `documentId`,
    // so both are needed to seed a realistic "just finished extracting"
    // state, matching what the real pipeline (`useDataExtraction`) does.
    dispatch(startChecking(prediction.document_id));
    dispatch(
      loaded({
        origin: "inference",
        prediction,
        validation: null,
        catalogsStale: prediction.catalogs_stale,
      }),
    );
  }, []);
  return <>{children}</>;
}

const FILE: DocFile = {
  data: new File(["x"], "acta.pdf"),
  paragraphs: [
    { id: "p0", document_id: "doc-1", value: "Texto original completo." },
  ],
  selected: true,
  validationObject: {},
};

describe("RecommendationValidation -- re-extraction remounts the form", () => {
  it("reflects the new prediction's fields after a successful re-extraction, not the frozen original", async () => {
    mockExtract.mockResolvedValue(
      aPrediction({
        recommendation_number: "999/2026",
        config: { model: "m", options: {}, catalogs_hash: "hash-2" },
        catalogs_stale: false,
      }),
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <FileContext.Provider value={[FILE]}>
            <RecommendationProvider>
              <SeedPrediction prediction={aPrediction()}>
                <RecommendationValidation />
              </SeedPrediction>
            </RecommendationProvider>
          </FileContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>,
    );

    const numberField = await screen.findByLabelText(
      "validation.recommendationNumber",
    );
    expect(numberField).toHaveValue("123/2026");

    fireEvent.click(
      screen.getByRole("button", { name: "validation.reExtract" }),
    );

    await waitFor(() =>
      expect(
        screen.getByLabelText("validation.recommendationNumber"),
      ).toHaveValue("999/2026"),
    );
  });
});
