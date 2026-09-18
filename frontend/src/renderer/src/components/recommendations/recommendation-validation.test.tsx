import { TooltipProvider } from "@aymurai/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useMemo } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DataExtractionPrediction,
  RecommendationValidationInput,
  RecommendationValidation as RecommendationValidationRecord,
} from "@/types/dataExtraction";
import type { PendingValidationField } from "@/utils/recommendations/pending-validation-fields";
import RecommendationValidation from "./recommendation-validation";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Interpolated `fields` are appended so a test can assert what the
    // message actually names. Every other call still returns the bare key,
    // which is what the existing assertions in this file match on.
    t: (key: string, options?: Record<string, unknown>) =>
      options && "fields" in options ? `${key}:${options.fields}` : key,
  }),
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

const showToast = vi.fn();
vi.mock("@/features/showToast", () => ({
  showToast: (...args: unknown[]) => showToast(...args),
}));

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
/** What the stubbed form reports as still-unvalidated; set per test. */
let mockPendingFields: PendingValidationField[] = [];
/**
 * Bumped by a test to simulate "the form now reports a different
 * pending-fields list" (i.e. an edit), since the stub's mount effect
 * otherwise only fires once. Not read by the effect body, only used to
 * force it to re-run against the (by-then-updated) `mockPendingFields`.
 */
let mockPendingFieldsVersion = 0;

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
    onPendingFieldsChange,
  }: {
    prediction: DataExtractionPrediction;
    validation: RecommendationValidationRecord | null;
    onValuesChange?: (payload: RecommendationValidationInput) => void;
    onPendingFieldsChange?: (fields: PendingValidationField[]) => void;
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

    // Module-scope value, fixed before render by each test -- reported once
    // on mount, the same beat the real form reports it on. A test that wants
    // to simulate an edit changing the pending-fields list bumps
    // `mockPendingFieldsVersion` after updating `mockPendingFields`, which
    // re-runs this effect and reports the new array.
    // biome-ignore lint/correctness/useExhaustiveDependencies: mockPendingFieldsVersion is a test-only re-fire trigger (outer-scope value), not read in the body
    useEffect(() => {
      onPendingFieldsChange?.(mockPendingFields);
    }, [onPendingFieldsChange, mockPendingFieldsVersion]);

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
    // The blocked-save reason hangs off a Radix Tooltip on the footer
    // button, which throws without a provider ancestor; `app.tsx` supplies
    // one globally.
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RecommendationValidation />
      </TooltipProvider>
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
    showToast.mockReset();
    mockPendingFields = [];
    mockPendingFieldsVersion = 0;
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
  });

  // The reason lives on the button, not in a second banner beside it: the
  // actionable notice is the one `RecipientFields` renders under the sector
  // field. A disabled button emits no pointer events, so this asserts the
  // path that actually has to work -- the wrapper that carries the tooltip.
  it("explains the blocked save on the button itself", async () => {
    mockUnits = TREE;
    mockRecipients = [aRecipientPayload({ sector_id: "otro" })];
    renderValidation();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "validation.validate" }),
      ).toBeDisabled(),
    );

    fireEvent.focus(
      screen.getByRole("button", { name: "validation.validate" })
        .parentElement as HTMLElement,
    );

    await waitFor(() =>
      expect(
        screen.getAllByText(/validation.blockedBySectorMismatch/).length,
      ).toBeGreaterThan(0),
    );
  });

  it("keeps the footer free of a second warning banner", async () => {
    mockUnits = TREE;
    mockRecipients = [aRecipientPayload({ sector_id: "otro" })];
    renderValidation();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "validation.validate" }),
      ).toBeDisabled(),
    );

    // Nothing is shown until the reason is asked for -- the banner that used
    // to sit in `AppFooter`'s `actions` slot stretched the footer.
    expect(
      screen.queryByText(/validation.blockedBySectorMismatch/),
    ).not.toBeInTheDocument();
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

  // The notice now lives on the processing screen, where the recovery
  // actually happens -- see `recommendation-process.test.tsx`.
  it("does not repeat the already-validated notice in the form", () => {
    renderValidation({ origin: "validation", validation: aValidation() });
    expect(
      screen.queryByText("validation.alreadyValidated"),
    ).not.toBeInTheDocument();
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

  // ADR-0013 (enmienda 2026-09-18): saving a field nobody validated is
  // allowed, but it must be something the person chose, not something that
  // happened to them.
  it("warns instead of saving when a suggested field was never validated", async () => {
    mockPendingFields = [{ labelKey: "topic" }];
    renderValidation();

    fireEvent.click(
      screen.getByRole("button", { name: "validation.validate" }),
    );

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith(
      "validation.unvalidatedFieldsWarning:validation.topic",
      "warning",
    );
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it("names every pending field, recipients by number", async () => {
    mockPendingFields = [
      { labelKey: "topic" },
      { labelKey: "position", recipientIndex: 1 },
    ];
    renderValidation();

    fireEvent.click(
      screen.getByRole("button", { name: "validation.validate" }),
    );

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "validation.unvalidatedFieldsWarning:validation.topic, validation.recipientLabel 2: validation.position",
        "warning",
      ),
    );
  });

  // The warning is a warning, not a gate: the second press goes through with
  // the fields still empty. Blocking outright is the alternative ADR-0013
  // rejected.
  it("saves on the second press, with the fields still empty", async () => {
    mockPendingFields = [{ labelKey: "topic" }];
    renderValidation();

    fireEvent.click(
      screen.getByRole("button", { name: "validation.validate" }),
    );
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole("button", { name: "validation.validateAnyway" }),
    );

    await waitFor(() => expect(mockValidate).toHaveBeenCalled());
  });

  it("saves on the first press when nothing is left to validate", async () => {
    mockPendingFields = [];
    renderValidation();

    fireEvent.click(
      screen.getByRole("button", { name: "validation.validate" }),
    );

    await waitFor(() => expect(mockValidate).toHaveBeenCalled());
    expect(showToast).not.toHaveBeenCalled();
  });

  // A confirmation belongs to the list it was given for: any edit to the
  // form must re-arm the warning instead of letting a stale "yes" wave
  // through a since-changed set of pending fields.
  it("re-arms the warning after an edit changes the pending-fields list", async () => {
    mockPendingFields = [{ labelKey: "topic" }];
    renderValidation();

    fireEvent.click(
      screen.getByRole("button", { name: "validation.validate" }),
    );
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(mockValidate).not.toHaveBeenCalled();

    // Simulate an edit: the form now reports a different pending-fields
    // list (a new array reference, as the real memo would produce), and an
    // actual field edit forces the stub to re-render and re-report it.
    mockPendingFields = [{ labelKey: "subtopic" }];
    mockPendingFieldsVersion += 1;
    fireEvent.change(screen.getByLabelText("validation.publishableContent"), {
      target: { value: "edited content" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "validation.validate" }),
    );

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(2));
    expect(mockValidate).not.toHaveBeenCalled();
  });
});
