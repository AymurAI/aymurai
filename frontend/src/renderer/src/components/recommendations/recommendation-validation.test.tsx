import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useMemo } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DataExtractionPrediction,
  RecommendationValidationInput,
  RecommendationValidation as RecommendationValidationRecord,
} from "@/types/dataExtraction";
import RecommendationValidation from "./recommendation-validation";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/layout/header", () => ({
  default: () => <header />,
}));

// The document panel (`FileAnnotator`) pulls in `AnnotationProvider`,
// `ReadingColumn` and the search bar -- none of that is this screen's own
// behaviour to verify, so it's stubbed the same way
// `recommendation-process.test.tsx` stubs `FileProcessing`.
vi.mock("@/components", () => ({
  FileAnnotator: () => <div data-testid="file-annotator" />,
}));

const mockFiles = [
  {
    data: new File(["x"], "acta.pdf"),
    paragraphs: [
      { id: "p0", document_id: "doc-1", value: "Texto original completo." },
    ],
    selected: true,
    validationObject: {},
  },
];
vi.mock("@/hooks", () => ({ useFiles: () => mockFiles }));

const { mockDispatch, mockNavigate, mockValidate, mockExtract } = vi.hoisted(
  () => ({
    mockDispatch: vi.fn(),
    mockNavigate: vi.fn(),
    mockValidate: vi.fn(),
    mockExtract: vi.fn(),
  }),
);

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/services/aymurai/dataExtraction", () => ({
  validateRecommendation: () => ({ mutationFn: mockValidate }),
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
    config: { model: "m", options: {}, catalogs_hash: "hash" },
    catalogs_stale: false,
    ...partial,
  };
}

function aValidation(
  partial: Partial<RecommendationValidationRecord> = {},
): RecommendationValidationRecord {
  return {
    id: "validation-1",
    document_id: "doc-1",
    recommendation_number: "123/2026",
    recommendation_date_text: "22 de noviembre",
    recommendation_date: "2026-11-22",
    topic: "Salud",
    subtopic: null,
    personal_data: null,
    publishable_content: "Contenido publicable.",
    recipients: [],
    source_text: "Texto original completo.",
    prediction: {},
    ...partial,
  };
}

// A minimal stand-in for `<RecommendationForm>` (Task 11/12, its own
// dedicated test suite already covers its internal behaviour). This screen
// only needs (a) something rendering the `publishable_content` field so a
// person can edit it, and (b) the same `onValuesChange` lifting contract the
// Reassignable so the save-gate tests can hand the screen a recipient whose
// validated sector contradicts its unit; every other test leaves it empty.
let mockRecipients: RecommendationValidationInput["recipients"] = [];

// `ministerio` [sector] > `direccion`; `otro` [sector] is somewhere else, so
// pairing `direccion` with `otro` is exactly what the server 422s on.
let mockUnits: unknown[] = [];
/** Bumped when the corpus is actually fetched, so a test asserting that
 *  nothing blocks can first wait for the fetch instead of racing it. */
let mockUnitsFetches = 0;

vi.mock("@/services/aymurai/organigram", () => ({
  listUnits: () => ({
    queryKey: ["organigram-units"],
    queryFn: async () => {
      mockUnitsFetches += 1;
      return mockUnits;
    },
  }),
}));

// real form now exposes (see `recommendation-form.tsx`'s effect) -- fires
// once on mount with the seeded payload, then again on every edit.
vi.mock("./recommendation-form", () => ({
  default: ({
    prediction,
    onValuesChange,
  }: {
    prediction: DataExtractionPrediction;
    validation: RecommendationValidationRecord | null;
    onValuesChange?: (payload: RecommendationValidationInput) => void;
  }) => {
    // Memoized (stable reference across re-renders unless `prediction`
    // itself changes) so the mount effect below fires exactly once instead
    // of looping: `onValuesChange` is the parent's `setPayload`, which would
    // otherwise see a new object on every commit and re-render forever.
    const seeded: RecommendationValidationInput = useMemo(
      () => ({
        recommendation_number: prediction.recommendation_number,
        recommendation_date_text: prediction.recommendation_date,
        recommendation_date: null,
        topic: prediction.topic,
        subtopic: prediction.subtopic,
        personal_data: prediction.personal_data,
        publishable_content: prediction.publishable_content,
        recipients: mockRecipients,
      }),
      [prediction],
    );

    useEffect(() => {
      onValuesChange?.(seeded);
    }, [seeded, onValuesChange]);

    return (
      <textarea
        aria-label="validation.publishableContent"
        defaultValue={prediction.publishable_content}
        onChange={(event) =>
          onValuesChange?.({
            ...seeded,
            publishable_content: event.target.value,
          })
        }
      />
    );
  },
}));

let mockRecommendationState: {
  status: string;
  documentId: string | null;
  sourceFileName: string | null;
  origin: string | null;
  prediction: DataExtractionPrediction | null;
  validation: RecommendationValidationRecord | null;
  catalogsStale: boolean;
  error: string | null;
  isScannedPdf: boolean;
};

vi.mock("@/context/Recommendation", () => ({
  useRecommendation: () => mockRecommendationState,
  useRecommendationDispatch: () => mockDispatch,
  loaded: (input: unknown) => ({ type: "loaded", ...(input as object) }),
}));

function renderValidation(
  overrides: Partial<typeof mockRecommendationState> = {},
) {
  mockRecommendationState = {
    status: "ready",
    documentId: "doc-1",
    sourceFileName: "acta.pdf",
    origin: "inference",
    prediction: aPrediction(),
    validation: null,
    catalogsStale: false,
    error: null,
    isScannedPdf: false,
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RecommendationValidation />
    </QueryClientProvider>,
  );
}

describe("RecommendationValidation", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockNavigate.mockClear();
    mockValidate.mockReset();
    mockValidate.mockResolvedValue(aValidation());
    mockExtract.mockReset();
    mockExtract.mockResolvedValue(aPrediction());
    mockRecipients = [];
    mockUnits = [];
    mockUnitsFetches = 0;
  });

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

  function aRecipientPayload(
    overrides: Partial<
      RecommendationValidationInput["recipients"][number]
    > = {},
  ): RecommendationValidationInput["recipients"][number] {
    return {
      source_index: 0,
      name: "Ana Pérez",
      position: "Directora",
      is_primary: true,
      macro_sector: "GCBA",
      unit_id: "direccion",
      sector_id: "ministerio",
      ...overrides,
    };
  }

  // The hard requirement from the QA round: a sector validated by hand that
  // does not contain its unit must not be submittable. The server refuses it
  // with a 422 (ADR-0009); the button never gets the chance.
  it("blocks validating while a recipient's sector contradicts its unit", async () => {
    mockUnits = TREE;
    mockRecipients = [aRecipientPayload({ sector_id: "otro" })];
    renderValidation();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "validation.validate" }),
      ).toBeDisabled(),
    );
    expect(
      screen.getByText(/validation.blockedBySectorMismatch/),
    ).toBeInTheDocument();
  });

  it("allows validating once the pair agrees", async () => {
    mockUnits = TREE;
    mockRecipients = [aRecipientPayload()];
    renderValidation();

    // Wait for the corpus to actually land, so this is not just winning a
    // race against the fetch that would make anything look enabled.
    await waitFor(() => expect(mockUnitsFetches).toBeGreaterThan(0));
    expect(
      screen.getByRole("button", { name: "validation.validate" }),
    ).toBeEnabled();
    expect(
      screen.queryByText(/validation.blockedBySectorMismatch/),
    ).not.toBeInTheDocument();
  });

  // Nothing may be blocked on a guess: with no organigram loaded the rule
  // cannot prove a mismatch, so the server stays the backstop.
  it("does not block while the organigram has not loaded", async () => {
    mockUnits = [];
    mockRecipients = [aRecipientPayload({ sector_id: "otro" })];
    renderValidation();

    expect(
      screen.getByRole("button", { name: "validation.validate" }),
    ).toBeEnabled();
  });

  it("blocks navigation when saving fails", async () => {
    mockValidate.mockRejectedValueOnce(new Error("500"));
    renderValidation();

    fireEvent.click(
      screen.getByRole("button", { name: "validation.validate" }),
    );

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not show a banner for a plain stored-inference (never requested)", () => {
    renderValidation({ origin: "stored-inference" });
    expect(
      screen.queryByText("validation.storedInference"),
    ).not.toBeInTheDocument();
  });

  it("shows the already-validated banner", () => {
    renderValidation({ origin: "validation", validation: aValidation() });
    expect(screen.getByText("validation.alreadyValidated")).toBeInTheDocument();
  });

  it("offers to re-extract when the taxonomy changed", async () => {
    renderValidation({ catalogsStale: true });

    fireEvent.click(
      screen.getByRole("button", { name: "validation.reExtract" }),
    );

    await waitFor(() =>
      expect(mockExtract).toHaveBeenCalledWith(
        expect.objectContaining({ useCache: false }),
        expect.anything(),
      ),
    );
  });

  it("shows an error and leaves the button available to retry when re-extraction fails", async () => {
    mockExtract.mockRejectedValueOnce(new Error("500"));
    renderValidation({ catalogsStale: true });

    fireEvent.click(
      screen.getByRole("button", { name: "validation.reExtract" }),
    );

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: "validation.reExtract" }),
    ).not.toBeDisabled();
    // Doesn't clobber the extraction already in the context -- only a
    // successful re-extraction dispatches `loaded`.
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("sends the typed value to the server, not the raw inference", async () => {
    renderValidation();

    const field = screen.getByLabelText("validation.publishableContent");
    fireEvent.change(field, { target: { value: "texto corregido" } });
    fireEvent.click(
      screen.getByRole("button", { name: "validation.validate" }),
    );

    await waitFor(() =>
      expect(mockValidate).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            publishable_content: "texto corregido",
          }),
        }),
        expect.anything(),
      ),
    );
  });

  it("blocks navigation until a document is loaded (no prediction and no validation)", () => {
    renderValidation({ prediction: null, validation: null });
    expect(
      screen.getByText("validation.missingPrediction"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "validation.validate" }),
    ).not.toBeInTheDocument();
  });
});
