import { afterEach, describe, expect, it, vi } from "vitest";
import api from "@/services/api";
import type { RecommendationValidationInput } from "@/types/dataExtraction";
import * as dataExtraction from "./dataExtraction";

vi.mock("@/constants/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/config")>()),
  USE_MOCK_DATA_EXTRACTION: false,
}));

const DOCUMENT_ID = "11111111-1111-1111-1111-111111111111";

const SAMPLE_ROW = {
  id: "recommendation-1",
  document_id: DOCUMENT_ID,
  recommendation_number: "123/2026",
  recommendation_date_text: "22 de noviembre",
  recommendation_date: "2026-11-22",
  topic: "Salud",
  subtopic: "Acceso a medicamentos",
  personal_data: false,
  publishable_content: "contenido",
  recipients: [],
  file_number: "EX-2026-00123",
  recommendation_detail: null,
  recommendation_situation: "Notificado",
  status: null,
  approved_for_publication: null,
  link: null,
  // The real wire format: FastAPI serializes these naive, with no `Z` and
  // no offset, even though the instant they carry is UTC.
  created_at: "2026-09-01T00:00:00",
  updated_at: null,
};

const SAMPLE_DETAIL = {
  ...SAMPLE_ROW,
  source_text: "El organismo destinatario deberá arbitrar los medios.",
  // The real raw stored shape (`RawExtraction.model_dump()`) -- see
  // task-2-report.md: it is narrower than `DataExtractionPrediction`, which
  // is why `predictionFromDetail` was not implemented in this task.
  prediction: {
    recommendation_number: "123/2026",
    recommendation_date: "22 de noviembre",
    recipients: [],
    topic: "Salud",
    subtopic: "Acceso a medicamentos",
    personal_data: false,
    publishable_content: "contenido",
  },
};

describe("dataExtraction service — real (non-mock) implementation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses an empty envelope for an unprocessed document", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: {
        document_id: DOCUMENT_ID,
        prediction: null,
        validation: null,
        catalogs_stale: false,
        updated_at: null,
      },
    });

    const { queryFn } = dataExtraction.documentExtractionEnvelope(DOCUMENT_ID);
    const result = await (queryFn as () => Promise<unknown>)();

    expect(result).toMatchObject({ prediction: null, validation: null });
  });

  it("fetches the envelope from GET /llm/data-extraction/{id}", async () => {
    const getSpy = vi.spyOn(api, "get").mockResolvedValue({
      data: {
        document_id: DOCUMENT_ID,
        prediction: null,
        validation: null,
        catalogs_stale: false,
        updated_at: null,
      },
    });

    const { queryFn } = dataExtraction.documentExtractionEnvelope(DOCUMENT_ID);
    await (queryFn as () => Promise<unknown>)();

    expect(getSpy).toHaveBeenCalledWith(`/llm/data-extraction/${DOCUMENT_ID}`);
  });

  it("extracts a document via POST /llm/data-extraction", async () => {
    const prediction = {
      document_id: DOCUMENT_ID,
      recommendation_number: null,
      recommendation_date: null,
      recipients: [],
      topic: null,
      subtopic: null,
      personal_data: null,
      publishable_content: "",
      config: { model: "m", options: {}, catalogs_hash: "h" },
      catalogs_stale: false,
    };
    const postSpy = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: prediction });

    const { mutationFn } = dataExtraction.extractDocument();
    const result = await (
      mutationFn as (i: {
        documentId: string;
        paragraphs: string[];
      }) => Promise<unknown>
    )({ documentId: DOCUMENT_ID, paragraphs: ["hola"] });

    expect(postSpy).toHaveBeenCalledWith(
      "/llm/data-extraction",
      {
        document: {
          document_id: DOCUMENT_ID,
          document: ["hola"],
          file_name: null,
        },
      },
      { params: { use_cache: true }, signal: undefined },
    );
    expect(result).toEqual(prediction);
  });

  it("forwards the uploaded file's name as document.file_name", async () => {
    const postSpy = vi.spyOn(api, "post").mockResolvedValue({
      data: {
        document_id: DOCUMENT_ID,
        recommendation_number: null,
        recommendation_date: null,
        recipients: [],
        topic: null,
        subtopic: null,
        personal_data: null,
        publishable_content: "",
        config: { model: "m", options: {}, catalogs_hash: "h" },
        catalogs_stale: false,
      },
    });

    const { mutationFn } = dataExtraction.extractDocument();
    await (
      mutationFn as (i: {
        documentId: string;
        paragraphs: string[];
        fileName?: string | null;
      }) => Promise<unknown>
    )({
      documentId: DOCUMENT_ID,
      paragraphs: ["hola"],
      fileName: "Resolucion-1234-24.docx",
    });

    expect(postSpy).toHaveBeenCalledWith(
      "/llm/data-extraction",
      {
        document: {
          document_id: DOCUMENT_ID,
          document: ["hola"],
          file_name: "Resolucion-1234-24.docx",
        },
      },
      { params: { use_cache: true }, signal: undefined },
    );
  });

  it("defaults use_cache to true and forwards an explicit false", async () => {
    const postSpy = vi.spyOn(api, "post").mockResolvedValue({
      data: {
        document_id: DOCUMENT_ID,
        recommendation_number: null,
        recommendation_date: null,
        recipients: [],
        topic: null,
        subtopic: null,
        personal_data: null,
        publishable_content: "",
        config: { model: "m", options: {}, catalogs_hash: "h" },
        catalogs_stale: false,
      },
    });

    const { mutationFn } = dataExtraction.extractDocument();
    await (
      mutationFn as (i: {
        documentId: string;
        paragraphs: string[];
        useCache?: boolean;
      }) => Promise<unknown>
    )({ documentId: DOCUMENT_ID, paragraphs: ["hola"], useCache: false });

    expect(postSpy).toHaveBeenCalledWith(
      "/llm/data-extraction",
      expect.anything(),
      expect.objectContaining({ params: { use_cache: false } }),
    );
  });

  it("validates a recommendation via PUT /llm/data-extraction/{id}/validate", async () => {
    const validation = {
      id: "rec-1",
      document_id: DOCUMENT_ID,
      recommendation_number: null,
      recommendation_date_text: null,
      recommendation_date: null,
      topic: null,
      subtopic: null,
      personal_data: null,
      publishable_content: "",
      recipients: [],
      source_text: "",
      prediction: {},
    };
    const putSpy = vi.spyOn(api, "put").mockResolvedValue({ data: validation });

    const payload: RecommendationValidationInput = {
      recommendation_number: null,
      recommendation_date_text: null,
      recommendation_date: null,
      topic: null,
      subtopic: null,
      personal_data: null,
      publishable_content: "",
      recipients: [],
    };

    const { mutationFn } = dataExtraction.validateRecommendation();
    const result = await (
      mutationFn as (i: {
        documentId: string;
        payload: RecommendationValidationInput;
      }) => Promise<unknown>
    )({ documentId: DOCUMENT_ID, payload });

    expect(putSpy).toHaveBeenCalledWith(
      `/llm/data-extraction/${DOCUMENT_ID}/validate`,
      payload,
    );
    expect(result).toEqual(validation);
  });

  it("downloads the recommendations export as a blob via GET /llm/data-extraction/export", async () => {
    const blob = new Blob(["x"]);
    const getSpy = vi.spyOn(api, "get").mockResolvedValue({
      data: blob,
      headers: {
        "content-disposition":
          'attachment; filename="recomendaciones_20260921231500.csv"',
      },
    });

    const { mutationFn } = dataExtraction.downloadRecommendationsExport();
    const result = await (
      mutationFn as (
        format?: "xlsx" | "csv",
      ) => Promise<{ blob: Blob; fileName: string }>
    )("csv");

    expect(getSpy).toHaveBeenCalledWith("/llm/data-extraction/export", {
      params: { format: "csv" },
      responseType: "blob",
    });
    expect(result.blob).toBe(blob);
    expect(result.fileName).toBe("recomendaciones_20260921231500.csv");
  });

  it("fetches recommendations via GET /llm/data-extraction/recommendations with all params", async () => {
    const page = { items: [SAMPLE_ROW], total: 1, page: 2, page_size: 10 };
    const getSpy = vi.spyOn(api, "get").mockResolvedValue({ data: page });

    const { queryFn } = dataExtraction.recommendationsList({
      page: 2,
      pageSize: 10,
      orderBy: "recommendation_date",
      orderDir: "asc",
      unparsedDates: true,
      q: "salud",
      topicId: "topic-1",
      sectorId: "sector-1",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    });
    const result = await (queryFn as () => Promise<unknown>)();

    expect(getSpy).toHaveBeenCalledWith(
      "/llm/data-extraction/recommendations",
      {
        params: {
          page: 2,
          page_size: 10,
          order_by: "recommendation_date",
          order_dir: "asc",
          unparsed_dates: true,
          q: "salud",
          topic_id: "topic-1",
          sector_id: "sector-1",
          date_from: "2026-01-01",
          date_to: "2026-12-31",
        },
      },
    );
    expect(result).toEqual(page);
  });

  it("fetches recommendation enums via GET /catalogs/recommendation-enums", async () => {
    const enums = { situations: ["Respuesta"], statuses: ["Solucionado"] };
    const getSpy = vi.spyOn(api, "get").mockResolvedValue({ data: enums });

    const { queryFn } = dataExtraction.recommendationEnums();
    const result = await (queryFn as () => Promise<unknown>)();

    expect(getSpy).toHaveBeenCalledWith("/catalogs/recommendation-enums");
    expect(result).toEqual(enums);
  });

  it("patches seguimiento fields via PATCH /llm/data-extraction/recommendations/{id}", async () => {
    const patchSpy = vi
      .spyOn(api, "patch")
      .mockResolvedValue({ data: SAMPLE_ROW });

    const { mutationFn } = dataExtraction.patchRecommendationSeguimiento();
    const result = await (
      mutationFn as (i: {
        recommendationId: string;
        payload: Partial<{
          file_number: string | null;
          recommendation_detail: string | null;
          recommendation_situation: string | null;
          status: string | null;
          approved_for_publication: boolean | null;
          link: string | null;
        }>;
      }) => Promise<unknown>
    )({
      recommendationId: "recommendation-1",
      payload: { file_number: "EX-2026-00123", status: "Solucionado" },
    });

    expect(patchSpy).toHaveBeenCalledWith(
      "/llm/data-extraction/recommendations/recommendation-1",
      { file_number: "EX-2026-00123", status: "Solucionado" },
    );
    expect(result).toEqual(SAMPLE_ROW);
  });

  it("omits absent payload keys from the PATCH body instead of sending null/undefined", async () => {
    const patchSpy = vi
      .spyOn(api, "patch")
      .mockResolvedValue({ data: SAMPLE_ROW });

    const { mutationFn } = dataExtraction.patchRecommendationSeguimiento();
    await (
      mutationFn as (i: {
        recommendationId: string;
        payload: Partial<{ status: string | null }>;
      }) => Promise<unknown>
    )({
      recommendationId: "recommendation-1",
      payload: { status: "Solucionado" },
    });

    const body = patchSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    // The other five seguimiento keys must not merely be `undefined` --
    // `JSON.stringify` would still omit an `undefined` value, but they must
    // not be own keys of the body at all, matching the brief's requirement
    // that an absent field never travels (the backend reads `exclude_unset`,
    // not "value is null/undefined").
    expect(Object.keys(body)).toEqual(["status"]);
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({ status: "Solucionado" }),
    );
    for (const key of [
      "file_number",
      "recommendation_detail",
      "recommendation_situation",
      "approved_for_publication",
      "link",
    ]) {
      expect(Object.hasOwn(body, key)).toBe(false);
    }
  });

  it("fetches recommendation detail via GET /llm/data-extraction/recommendations/{id}", async () => {
    const getSpy = vi
      .spyOn(api, "get")
      .mockResolvedValue({ data: SAMPLE_DETAIL });

    const { queryFn } = dataExtraction.recommendationDetail("recommendation-1");
    const result = await (queryFn as () => Promise<unknown>)();

    expect(getSpy).toHaveBeenCalledWith(
      "/llm/data-extraction/recommendations/recommendation-1",
    );
    expect(result).toEqual(SAMPLE_DETAIL);
  });

  it("saves a correction via PUT /llm/data-extraction/recommendations/{id} with the If-Match header", async () => {
    const putSpy = vi
      .spyOn(api, "put")
      .mockResolvedValue({ data: SAMPLE_DETAIL });

    const payload: RecommendationValidationInput = {
      recommendation_number: "123/2026",
      recommendation_date_text: "22 de noviembre",
      recommendation_date: "2026-11-22",
      topic: "Salud",
      subtopic: "Acceso a medicamentos",
      personal_data: false,
      publishable_content: "contenido",
      recipients: [],
    };

    const { mutationFn } = dataExtraction.correctRecommendation();
    const result = await (
      mutationFn as (i: {
        recommendationId: string;
        ifMatch: string;
        payload: RecommendationValidationInput;
      }) => Promise<unknown>
    )({
      recommendationId: "recommendation-1",
      ifMatch: "2026-09-01T00:00:00",
      payload,
    });

    expect(putSpy).toHaveBeenCalledWith(
      "/llm/data-extraction/recommendations/recommendation-1",
      payload,
      { headers: { "If-Match": "2026-09-01T00:00:00" } },
    );
    expect(result).toEqual(SAMPLE_DETAIL);
  });
});

// Isolated from the describe blocks above: the file-level `vi.mock` pins
// USE_MOCK_DATA_EXTRACTION to false for every static import, so exercising the
// mock branch needs a fresh module registry with that flag overridden, same
// as `services/api.test.ts` does for its own per-test env/mock switching.
describe("dataExtraction service — mock implementation", () => {
  afterEach(() => {
    vi.doUnmock("@/constants/config");
    vi.resetModules();
  });

  it("returns the mock export without calling the real API when USE_MOCK_DATA_EXTRACTION is true", async () => {
    vi.resetModules();
    vi.doMock("@/constants/config", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants/config")>()),
      USE_MOCK_DATA_EXTRACTION: true,
    }));

    const { default: mockedApi } = await import("@/services/api");
    const getSpy = vi.spyOn(mockedApi, "get");
    const mockedDataExtraction = await import("./dataExtraction");

    const { mutationFn } = mockedDataExtraction.downloadRecommendationsExport();
    const result = await (
      mutationFn as (
        format?: "xlsx" | "csv",
      ) => Promise<{ blob: Blob; fileName: string }>
    )("csv");

    expect(getSpy).not.toHaveBeenCalled();
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.fileName).toMatch(/^recomendaciones_\d{14}\.csv$/);
  });

  it("lists recommendations from the in-memory mock without calling the real API when USE_MOCK_DATA_EXTRACTION is true", async () => {
    vi.resetModules();
    vi.doMock("@/constants/config", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants/config")>()),
      USE_MOCK_DATA_EXTRACTION: true,
    }));

    const { default: mockedApi } = await import("@/services/api");
    const getSpy = vi.spyOn(mockedApi, "get");
    const mockedDataExtraction = await import("./dataExtraction");

    const { queryFn } = mockedDataExtraction.recommendationsList({});
    const result = (await (queryFn as () => Promise<unknown>)()) as {
      items: unknown[];
      page: number;
      page_size: number;
    };

    expect(getSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ page: 1, page_size: 20 });
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("returns mock recommendation enums without calling the real API when USE_MOCK_DATA_EXTRACTION is true", async () => {
    vi.resetModules();
    vi.doMock("@/constants/config", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants/config")>()),
      USE_MOCK_DATA_EXTRACTION: true,
    }));

    const { default: mockedApi } = await import("@/services/api");
    const getSpy = vi.spyOn(mockedApi, "get");
    const mockedDataExtraction = await import("./dataExtraction");

    const { queryFn } = mockedDataExtraction.recommendationEnums();
    const result = (await (queryFn as () => Promise<unknown>)()) as {
      situations: string[];
      statuses: string[];
    };

    expect(getSpy).not.toHaveBeenCalled();
    expect(result.situations).toContain("Notificado");
    expect(result.statuses).toContain("Solucionado");
  });

  it("patches the in-memory mock recommendation without calling the real API when USE_MOCK_DATA_EXTRACTION is true", async () => {
    vi.resetModules();
    vi.doMock("@/constants/config", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants/config")>()),
      USE_MOCK_DATA_EXTRACTION: true,
    }));

    const { default: mockedApi } = await import("@/services/api");
    const patchSpy = vi.spyOn(mockedApi, "patch");
    const mockedDataExtraction = await import("./dataExtraction");

    const { mutationFn } =
      mockedDataExtraction.patchRecommendationSeguimiento();
    const result = (await (
      mutationFn as (i: {
        recommendationId: string;
        payload: Partial<{ status: string | null }>;
      }) => Promise<unknown>
    )({
      recommendationId: "recommendation-1",
      payload: { status: "Solucionado" },
    })) as { id: string; status: string | null };

    expect(patchSpy).not.toHaveBeenCalled();
    expect(result.id).toBe("recommendation-1");
    expect(result.status).toBe("Solucionado");
  });

  it("fetches the in-memory mock recommendation detail without calling the real API when USE_MOCK_DATA_EXTRACTION is true", async () => {
    vi.resetModules();
    vi.doMock("@/constants/config", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants/config")>()),
      USE_MOCK_DATA_EXTRACTION: true,
    }));

    const { default: mockedApi } = await import("@/services/api");
    const getSpy = vi.spyOn(mockedApi, "get");
    const mockedDataExtraction = await import("./dataExtraction");

    const { queryFn } =
      mockedDataExtraction.recommendationDetail("recommendation-1");
    const result = (await (queryFn as () => Promise<unknown>)()) as {
      id: string;
      source_text: string;
      prediction: Record<string, unknown>;
    };

    expect(getSpy).not.toHaveBeenCalled();
    expect(result.id).toBe("recommendation-1");
    expect(typeof result.source_text).toBe("string");
    expect(result.prediction).toBeTypeOf("object");
  });

  it("saves a correction against the in-memory mock without calling the real API when USE_MOCK_DATA_EXTRACTION is true", async () => {
    vi.resetModules();
    vi.doMock("@/constants/config", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants/config")>()),
      USE_MOCK_DATA_EXTRACTION: true,
    }));

    const { default: mockedApi } = await import("@/services/api");
    const putSpy = vi.spyOn(mockedApi, "put");
    const mockedDataExtraction = await import("./dataExtraction");

    const { queryFn: detailQueryFn } =
      mockedDataExtraction.recommendationDetail("recommendation-1");
    const detail = (await (detailQueryFn as () => Promise<unknown>)()) as {
      created_at: string;
      updated_at: string | null;
    };
    const etag = detail.updated_at ?? detail.created_at;

    const { mutationFn } = mockedDataExtraction.correctRecommendation();
    const result = (await (
      mutationFn as (i: {
        recommendationId: string;
        ifMatch: string;
        payload: RecommendationValidationInput;
      }) => Promise<unknown>
    )({
      recommendationId: "recommendation-1",
      ifMatch: etag,
      payload: {
        recommendation_number: "123/2026",
        recommendation_date_text: "22 de noviembre",
        recommendation_date: "2026-11-22",
        topic: "Salud",
        subtopic: "Corregido",
        personal_data: false,
        publishable_content: "corregido",
        recipients: [],
      },
    })) as { subtopic: string | null; publishable_content: string };

    expect(putSpy).not.toHaveBeenCalled();
    expect(result.subtopic).toBe("Corregido");
    expect(result.publishable_content).toBe("corregido");
  });

  it("rejects a mock correction with a stale If-Match, mirroring the real endpoint's 412", async () => {
    vi.resetModules();
    vi.doMock("@/constants/config", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants/config")>()),
      USE_MOCK_DATA_EXTRACTION: true,
    }));

    const mockedDataExtraction = await import("./dataExtraction");
    const { AxiosError } = await import("axios");

    const { mutationFn } = mockedDataExtraction.correctRecommendation();
    const call = (
      mutationFn as (i: {
        recommendationId: string;
        ifMatch: string;
        payload: RecommendationValidationInput;
      }) => Promise<unknown>
    )({
      recommendationId: "recommendation-1",
      ifMatch: "not-the-real-etag",
      payload: {
        recommendation_number: null,
        recommendation_date_text: null,
        recommendation_date: null,
        topic: null,
        subtopic: null,
        personal_data: null,
        publishable_content: "",
        recipients: [],
      },
    });

    await expect(call).rejects.toSatisfy(
      (error) => error instanceof AxiosError && error.response?.status === 412,
    );
  });
});

describe("dataExtraction service — validates responses with zod", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a malformed envelope instead of passing it through", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: { document_id: DOCUMENT_ID },
    });

    const { queryFn } = dataExtraction.documentExtractionEnvelope(DOCUMENT_ID);
    await expect((queryFn as () => Promise<unknown>)()).rejects.toThrow();
  });

  it("rejects a malformed prediction instead of passing it through", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { document_id: DOCUMENT_ID },
    });

    const { mutationFn } = dataExtraction.extractDocument();
    await expect(
      (
        mutationFn as (i: {
          documentId: string;
          paragraphs: string[];
        }) => Promise<unknown>
      )({ documentId: DOCUMENT_ID, paragraphs: ["hola"] }),
    ).rejects.toThrow();
  });

  it("rejects a malformed validation instead of passing it through", async () => {
    vi.spyOn(api, "put").mockResolvedValue({ data: { id: "rec-1" } });

    const { mutationFn } = dataExtraction.validateRecommendation();
    await expect(
      (
        mutationFn as (i: {
          documentId: string;
          payload: RecommendationValidationInput;
        }) => Promise<unknown>
      )({
        documentId: DOCUMENT_ID,
        payload: {
          recommendation_number: null,
          recommendation_date_text: null,
          recommendation_date: null,
          topic: null,
          subtopic: null,
          personal_data: null,
          publishable_content: "",
          recipients: [],
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a malformed recommendations page instead of passing it through", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      // missing `page`/`page_size`
      data: { items: [SAMPLE_ROW], total: 1 },
    });

    const { queryFn } = dataExtraction.recommendationsList({});
    await expect((queryFn as () => Promise<unknown>)()).rejects.toThrow();
  });

  it("rejects a malformed recommendation-enums response instead of passing it through", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      // missing `statuses`
      data: { situations: ["Respuesta"] },
    });

    const { queryFn } = dataExtraction.recommendationEnums();
    await expect((queryFn as () => Promise<unknown>)()).rejects.toThrow();
  });

  it("rejects a malformed recommendation row from the PATCH response instead of passing it through", async () => {
    vi.spyOn(api, "patch").mockResolvedValue({
      data: { id: "recommendation-1" },
    });

    const { mutationFn } = dataExtraction.patchRecommendationSeguimiento();
    await expect(
      (
        mutationFn as (i: {
          recommendationId: string;
          payload: Partial<{ status: string | null }>;
        }) => Promise<unknown>
      )({
        recommendationId: "recommendation-1",
        payload: { status: "Solucionado" },
      }),
    ).rejects.toThrow();
  });

  it("rejects a malformed recommendation detail instead of passing it through", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      // missing `source_text`/`prediction`
      data: SAMPLE_ROW,
    });

    const { queryFn } = dataExtraction.recommendationDetail("recommendation-1");
    await expect((queryFn as () => Promise<unknown>)()).rejects.toThrow();
  });

  it("rejects a malformed recommendation detail from the correction response instead of passing it through", async () => {
    vi.spyOn(api, "put").mockResolvedValue({
      // missing `source_text`/`prediction`
      data: SAMPLE_ROW,
    });

    const { mutationFn } = dataExtraction.correctRecommendation();
    await expect(
      (
        mutationFn as (i: {
          recommendationId: string;
          ifMatch: string;
          payload: RecommendationValidationInput;
        }) => Promise<unknown>
      )({
        recommendationId: "recommendation-1",
        ifMatch: "2026-09-01T00:00:00",
        payload: {
          recommendation_number: null,
          recommendation_date_text: null,
          recommendation_date: null,
          topic: null,
          subtopic: null,
          personal_data: null,
          publishable_content: "",
          recipients: [],
        },
      }),
    ).rejects.toThrow();
  });
});
