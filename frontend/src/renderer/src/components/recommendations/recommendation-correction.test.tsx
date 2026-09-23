import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AxiosError } from "axios";
import { useEffect, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DataExtractionPrediction,
  RecommendationDetail,
  RecommendationValidationInput,
} from "@/types/dataExtraction";
import type { DocFile } from "@/types/file";
import RecommendationCorrection from "./recommendation-correction";

vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "fields" in options
        ? `${key}:${options.fields}`
        : `${namespace ?? "common"}:${key}`,
  }),
}));

const { mockNavigate, mockDetail, mockCorrect, showToast } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockDetail: vi.fn(),
  mockCorrect: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/features/showToast", () => ({
  showToast: (...args: unknown[]) => showToast(...args),
}));

// The three factories this screen consumes. `recommendationsList` is only ever
// read for its query-key prefix (the invalidation after a successful save), so
// the stub returns just that.
vi.mock("@/services/aymurai/dataExtraction", () => ({
  recommendationDetail: (recommendationId: string) => ({
    queryKey: ["recommendation-detail", recommendationId],
    queryFn: () => mockDetail(recommendationId),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  }),
  correctRecommendation: () => ({ mutationFn: mockCorrect }),
  recommendationsList: () => ({ queryKey: ["recommendations-list", {}] }),
}));

/**
 * Captures what `<FileAnnotator>` was actually handed. The landmine this
 * screen exists around is `DocFile.data` being `undefined`, which
 * `AnnotationProvider` dereferences unconditionally — so the file itself is
 * what most assertions are about, not the annotator's rendering (which has
 * its own suite).
 *
 * `useRealAnnotator` flips this same stub to the REAL component instead, for
 * the one test that has to prove the whole provider tree actually mounts.
 * A flag rather than `vi.doUnmock` + `vi.resetModules`: both stubs in this
 * file have to survive, and re-importing the screen to drop one of them is a
 * far more fragile way to say the same thing.
 */
let annotatorFile: DocFile | null = null;
let useRealAnnotator = false;
vi.mock("@/components/file-annotator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/file-annotator")>();
  return {
    default: (props: React.ComponentProps<typeof actual.default>) => {
      annotatorFile = props.file;
      if (useRealAnnotator) return <actual.default {...props} />;
      return <div data-testid="file-annotator">{props.file.data.name}</div>;
    },
  };
});

/** What the stubbed form reports as still-unvalidated; set per test. */
let mockPendingFields: { labelKey: string; recipientIndex?: number }[] = [];
/** What the stubbed form reports as the current payload; set per test. */
let mockPayloadOverride: Partial<RecommendationValidationInput> = {};

/** The props the stubbed form was last rendered with — the ADR-0013 test
 *  asserts on `validation` directly, since "does not start blank" is a
 *  statement about what the form is seeded with. */
let formProps: {
  prediction: DataExtractionPrediction;
  validation: unknown;
} | null = null;

vi.mock("./recommendation-form", () => ({
  default: ({
    prediction,
    validation,
    onValuesChange,
    onPendingFieldsChange,
  }: {
    prediction: DataExtractionPrediction;
    validation: unknown;
    onValuesChange?: (payload: RecommendationValidationInput) => void;
    onPendingFieldsChange?: (
      fields: { labelKey: string; recipientIndex?: number }[],
    ) => void;
  }) => {
    formProps = { prediction, validation };
    // Memoized so the mount effect fires once instead of looping against the
    // parent's `setPayload`, same guard as `recommendation-validation.test.tsx`.
    const seeded: RecommendationValidationInput = useMemo(
      () => ({
        recommendation_number: prediction.recommendation_number,
        recommendation_date_text: prediction.recommendation_date,
        recommendation_date: null,
        topic: prediction.topic,
        subtopic: prediction.subtopic,
        personal_data: prediction.personal_data,
        publishable_content: prediction.publishable_content,
        recipients: [],
        ...mockPayloadOverride,
      }),
      [prediction],
    );
    useEffect(() => {
      onValuesChange?.(seeded);
    }, [seeded, onValuesChange]);
    useEffect(() => {
      onPendingFieldsChange?.(mockPendingFields);
    }, [onPendingFieldsChange]);
    return <div data-testid="recommendation-form" />;
  },
}));

/**
 * A realistic multi-paragraph recomendación body. Not a one-line invention:
 * the shape (título, lugar y fecha, considerandos, articulado) mirrors the
 * real documents in `resources/data/sample/`, which are `.docx` binaries that
 * a vitest module graph cannot read without pulling a parser into the test.
 * What matters for the split is that it has many paragraphs, blank lines
 * between blocks, and punctuation that is NOT a newline.
 */
const REAL_PARAGRAPHS = [
  "RECOMENDACIÓN Nº 123/2026",
  "",
  "Ciudad Autónoma de Buenos Aires, 22 de noviembre de 2026.",
  "",
  "VISTO la actuación Nº 4521/2026 iniciada de oficio por esta Defensoría del Pueblo, y",
  "CONSIDERANDO:",
  "Que se recibieron reclamos de vecinas y vecinos del barrio por demoras en la entrega de medicamentos esenciales en el hospital de referencia.",
  "Que la Ley Nº 153 de la Ciudad garantiza el derecho a la salud integral, y que su reglamentación impone al efector público la obligación de sostener el stock crítico.",
  "Que, requerido el descargo, el organismo no acreditó haber adoptado medidas para normalizar la provisión.",
  "",
  "Por ello, EL DEFENSOR DEL PUEBLO DE LA CIUDAD AUTÓNOMA DE BUENOS AIRES RESUELVE:",
  "Artículo 1º.- Recomendar al Ministerio de Salud que arbitre los medios necesarios para garantizar el acceso a medicamentos esenciales a la población afectada.",
  "Artículo 2º.- Regístrese, notifíquese y archívese.",
];
const REAL_SOURCE_TEXT = REAL_PARAGRAPHS.join("\n");

function aDetail(
  partial: Partial<RecommendationDetail> = {},
): RecommendationDetail {
  return {
    id: "rec-1",
    document_id: "doc-1",
    recommendation_number: "123/2026",
    recommendation_date_text: "22 de noviembre de 2026",
    recommendation_date: "2026-11-22",
    topic: "Salud",
    subtopic: "Medicamentos",
    personal_data: false,
    publishable_content: "Contenido publicable validado.",
    recipients: [
      {
        id: "recipient-1",
        source_index: 0,
        name: "Ana Pérez",
        position: "Ministra de Salud",
        is_primary: true,
        macro_sector: "GCBA",
        unit_id: "unit-1",
        unit_name: "Ministerio de Salud",
        sector_id: "sector-1",
        sector_name: "Ministerio de Salud",
      },
    ],
    file_number: "EX-2026-4521",
    recommendation_detail: null,
    recommendation_situation: null,
    status: null,
    approved_for_publication: null,
    link: null,
    created_at: "2026-11-22T10:00:00Z",
    updated_at: "2026-11-23T09:30:00Z",
    source_text: REAL_SOURCE_TEXT,
    prediction: {
      recommendation_number: "123/2026",
      recommendation_date: "22 de noviembre de 2026",
      recipients: [
        {
          name: "Ana Pérez",
          position: "Ministra de Salud",
          is_primary: true,
          macro_sector: "GCBA",
        },
      ],
      topic: "Salud",
      subtopic: "Medicamentos",
      personal_data: false,
      publishable_content: "Contenido publicable sugerido por el modelo.",
    },
    ...partial,
  };
}

function renderCorrection(recommendationId = "rec-1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <RecommendationCorrection recommendationId={recommendationId} />
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

function saveButton() {
  return screen.getByRole("button", {
    name: "recommendations:correction.save",
  });
}

/**
 * Waits until the stubbed form has reported BOTH its payload and its pending
 * fields. `findByTestId` only proves the node is in the DOM; the form's mount
 * effects can still be one flush behind, and a `pendingFields` update landing
 * after a click would reset the ADR-0013 confirmation the click just set
 * (the screen resets it on purpose whenever that list changes). On the real
 * screen the form reports long before a person can click; here the flush has
 * to be asked for.
 */
async function formSettled() {
  await screen.findByTestId("recommendation-form");
  await act(async () => {});
}

describe("RecommendationCorrection", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    showToast.mockReset();
    mockDetail.mockReset();
    mockDetail.mockResolvedValue(aDetail());
    mockCorrect.mockReset();
    mockCorrect.mockResolvedValue(aDetail());
    mockPendingFields = [];
    mockPayloadOverride = {};
    annotatorFile = null;
    formProps = null;
  });

  // ADR-0013 inverted (issue #58 asks for this explicitly): on a correction
  // the saved validated values are what the person must see. Blanking behind
  // a suggestion mark is for a FIRST validation pass, where the model's guess
  // is the only answer there is.
  it("seeds the form with the saved validation, not a null one", async () => {
    renderCorrection();

    await screen.findByTestId("recommendation-form");

    expect(formProps?.validation).not.toBeNull();
    // Not "some object": the exact saved row, field for field. A blank start
    // would show up here as nulls on fields the detail has values for.
    expect(formProps?.validation).toMatchObject({
      id: "rec-1",
      recommendation_number: "123/2026",
      recommendation_date: "2026-11-22",
      topic: "Salud",
      subtopic: "Medicamentos",
      publishable_content: "Contenido publicable validado.",
    });
    const validation = formProps?.validation as RecommendationDetail;
    expect(validation.recipients[0]).toMatchObject({
      name: "Ana Pérez",
      position: "Ministra de Salud",
      macro_sector: "GCBA",
      unit_id: "unit-1",
      sector_id: "sector-1",
    });
    // The frozen suggestion overlay stays the MODEL's answer, not the saved
    // one — that separation is the whole point of feeding both.
    expect(formProps?.prediction.publishable_content).toBe(
      "Contenido publicable sugerido por el modelo.",
    );
  });

  it("rebuilds the document's paragraphs from source_text, exactly", async () => {
    renderCorrection();

    await screen.findByTestId("file-annotator");

    // The backend composed `source_text` as `"\n".join(document.document)`
    // (`routers/defensoria/data_extraction.py`), so the split is its exact
    // inverse for this document — blank separator lines included, since a
    // blank line IS a paragraph of the original.
    expect(annotatorFile?.paragraphs?.map((p) => p.value)).toEqual(
      REAL_PARAGRAPHS,
    );
    expect(annotatorFile?.paragraphs).toHaveLength(REAL_PARAGRAPHS.length);
    // Deterministic, stable ids — the annotator and `buildAnnotations` key on
    // them, so they cannot be array positions of a re-derived list.
    expect(annotatorFile?.paragraphs?.[0]).toMatchObject({
      id: "rec-1-p0",
      document_id: "doc-1",
    });
  });

  // The one documented limitation (issue #58): the join that produced
  // `source_text` made a paragraph's own newline indistinguishable from a
  // paragraph boundary, so no split can recover it. Pinned here as the known
  // behaviour rather than left as a comment nobody re-checks.
  it("splits a paragraph that contained its own newline in two (known gap)", async () => {
    mockDetail.mockResolvedValue(
      aDetail({ source_text: "Artículo 1º.-\nRecomendar al organismo." }),
    );
    renderCorrection();

    await screen.findByTestId("file-annotator");

    expect(annotatorFile?.paragraphs?.map((p) => p.value)).toEqual([
      "Artículo 1º.-",
      "Recomendar al organismo.",
    ]);
  });

  it("saves with the If-Match etag, invalidates the grilla and navigates back", async () => {
    const { client } = renderCorrection();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await screen.findByTestId("recommendation-form");

    fireEvent.click(saveButton());

    await waitFor(() => expect(mockCorrect).toHaveBeenCalledTimes(1));
    // `mock.calls[0][0]`, not `toHaveBeenCalledWith`: React Query v5 hands the
    // mutation function a second (context) argument of its own.
    expect(mockCorrect.mock.calls[0][0]).toMatchObject({
      recommendationId: "rec-1",
      // `updated_at` when set, else `created_at` — the backend's own `_etag`.
      ifMatch: "2026-11-23T09:30:00Z",
      payload: { topic: "Salud" },
    });
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/home/dataset" }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["recommendations-list"],
    });
  });

  it("falls back to created_at for the etag when the row was never updated", async () => {
    mockDetail.mockResolvedValue(aDetail({ updated_at: null }));
    renderCorrection();
    await screen.findByTestId("recommendation-form");

    fireEvent.click(saveButton());

    await waitFor(() => expect(mockCorrect).toHaveBeenCalledTimes(1));
    expect(mockCorrect.mock.calls[0][0].ifMatch).toBe("2026-11-22T10:00:00Z");
  });

  it("reports a 412 conflict and never retries the save on its own", async () => {
    mockCorrect.mockRejectedValue(
      new AxiosError(
        "Precondition Failed",
        "ERR_BAD_REQUEST",
        undefined,
        undefined,
        {
          status: 412,
          statusText: "Precondition Failed",
          data: { detail: "Precondition Failed" },
          headers: {},
          config: {},
        } as never,
      ),
    );
    renderCorrection();
    await screen.findByTestId("recommendation-form");

    fireEvent.click(saveButton());

    expect(
      await screen.findByText("recommendations:correction.conflict"),
    ).toBeInTheDocument();
    // Retrying with the same stale etag is exactly what `If-Match` exists to
    // prevent, so the screen must not do it — and the save button is locked
    // until the person reloads.
    expect(mockCorrect).toHaveBeenCalledTimes(1);
    expect(saveButton()).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      screen.queryByText("recommendations:correction.saveFailed"),
    ).not.toBeInTheDocument();
  });

  it("lets the person reload the detail after a conflict and save again", async () => {
    mockCorrect.mockRejectedValueOnce(
      new AxiosError(
        "Precondition Failed",
        "ERR_BAD_REQUEST",
        undefined,
        undefined,
        {
          status: 412,
          statusText: "Precondition Failed",
          data: {},
          headers: {},
          config: {},
        } as never,
      ),
    );
    mockDetail
      .mockResolvedValueOnce(aDetail())
      .mockResolvedValueOnce(
        aDetail({ updated_at: "2026-11-24T11:00:00Z", topic: "Vivienda" }),
      );
    renderCorrection();
    await screen.findByTestId("recommendation-form");

    fireEvent.click(saveButton());
    await screen.findByText("recommendations:correction.conflict");

    fireEvent.click(
      screen.getByRole("button", { name: "recommendations:correction.reload" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByText("recommendations:correction.conflict"),
      ).not.toBeInTheDocument(),
    );
    // Remounted against the newer row: the form now holds the other person's
    // values, and the next save carries the newer etag.
    await waitFor(() =>
      expect(
        (formProps as { validation: RecommendationDetail }).validation.topic,
      ).toBe("Vivienda"),
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockCorrect).toHaveBeenCalledTimes(2));
    expect(mockCorrect.mock.calls[1][0].ifMatch).toBe("2026-11-24T11:00:00Z");
  });

  it("shows a generic error (not the conflict notice) on any other failure", async () => {
    mockCorrect.mockRejectedValue(new Error("network down"));
    renderCorrection();
    await screen.findByTestId("recommendation-form");

    fireEvent.click(saveButton());

    expect(
      await screen.findByText("recommendations:correction.saveFailed"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("recommendations:correction.conflict"),
    ).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // ADR-0013's enmienda: a field the person cleared is about to be persisted
  // empty. Name them once, then let the next press through.
  it("warns once by name before saving fields the person left blank", async () => {
    mockPendingFields = [{ labelKey: "subtopic" }];
    renderCorrection();
    await formSettled();

    fireEvent.click(saveButton());

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(showToast.mock.calls[0][0]).toContain(
      "validation.unvalidatedFieldsWarning",
    );
    expect(mockCorrect).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "recommendations:correction.saveAnyway",
      }),
    );
    await waitFor(() => expect(mockCorrect).toHaveBeenCalledTimes(1));
  });

  it("navigates back without saving when cancelled", async () => {
    renderCorrection();
    await screen.findByTestId("recommendation-form");

    fireEvent.click(
      screen.getByRole("button", { name: "recommendations:correction.cancel" }),
    );

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/home/dataset" });
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it("reports a failed load instead of rendering an empty screen", async () => {
    mockDetail.mockRejectedValue(new Error("boom"));
    renderCorrection();

    expect(
      await screen.findByText("recommendations:correction.loadFailed"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("recommendation-form")).not.toBeInTheDocument();
  });

  it("reports a stored prediction it cannot reconstruct instead of crashing", async () => {
    mockDetail.mockResolvedValue(aDetail({ prediction: { nope: true } }));
    renderCorrection();

    expect(
      await screen.findByText(
        "recommendations:correction.predictionUnavailable",
      ),
    ).toBeInTheDocument();
  });
});

/**
 * The regression this screen was built around, exercised against the REAL
 * `<FileAnnotator>` (and therefore the real `AnnotationProvider`, which
 * dereferences `file.data.name` inside seven `useCallback`s on every render,
 * regardless of `isAnnotable`). A synthetic `DocFile` with `data: undefined`
 * throws synchronously on mount, so "the screen renders at all" IS the
 * assertion.
 */
describe("RecommendationCorrection — the synthetic DocFile", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockDetail.mockReset();
    mockDetail.mockResolvedValue(aDetail());
    mockCorrect.mockReset();
    annotatorFile = null;
    formProps = null;
    useRealAnnotator = true;
  });

  afterEach(() => {
    useRealAnnotator = false;
  });

  it("mounts the real annotator without a crash, with a real File", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <RecommendationCorrection recommendationId="rec-1" />
      </QueryClientProvider>,
    );

    // The real annotator renders every paragraph into its reading column, so
    // these only exist if `AnnotationProvider` got past `file.data.name`.
    // Queried by paragraph id rather than by text: the extracted-value
    // highlights split a paragraph's text across several elements, which is
    // exactly what a plain `getByText` cannot match.
    const first = await screen.findByTestId("anon-reading-column");
    expect(
      first.querySelector('[data-paragraph-id="rec-1-p0"]')?.textContent,
    ).toBe("RECOMENDACIÓN Nº 123/2026");
    const lastIndex = REAL_PARAGRAPHS.length - 1;
    expect(
      first.querySelector(`[data-paragraph-id="rec-1-p${lastIndex}"]`)
        ?.textContent,
    ).toBe(REAL_PARAGRAPHS[lastIndex]);

    // And the reason it got past it: a real `File`, never `undefined`.
    expect(annotatorFile?.data).toBeInstanceOf(File);
    expect(annotatorFile?.data.name).toBe("recomendacion-rec-1.txt");
  });
});
