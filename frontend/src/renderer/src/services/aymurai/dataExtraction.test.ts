import { afterEach, describe, expect, it, vi } from "vitest";
import api from "@/services/api";
import type { RecommendationValidationInput } from "@/types/dataExtraction";
import * as dataExtraction from "./dataExtraction";

vi.mock("@/constants/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/config")>()),
  USE_MOCK_DATA_EXTRACTION: false,
}));

const DOCUMENT_ID = "11111111-1111-1111-1111-111111111111";

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
});
