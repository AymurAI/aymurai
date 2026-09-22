import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { USE_MOCK_DATA_EXTRACTION } from "@/constants/config";
import {
  dataExtractionPredictionSchema,
  documentExtractionEnvelopeSchema,
  recommendationEnumsSchema,
  recommendationPageSchema,
  recommendationRowSchema,
  recommendationValidationSchema,
} from "@/schema/dataExtraction";
import type { RecommendationValidationInput } from "@/types/dataExtraction";
import api from "../api";
import * as mock from "./mockDataExtraction";

export const documentExtractionEnvelope = (documentId: string) =>
  queryOptions({
    queryKey: ["document-extraction", documentId, api.defaults.baseURL],
    // The process screen decides whether to spend an inference from this
    // answer, so a stale cache would re-decide wrongly; and a failure must
    // surface, never resolve to an empty envelope (see useDataExtraction).
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => {
      const data = USE_MOCK_DATA_EXTRACTION
        ? await mock.mockDocumentExtractionEnvelope(documentId)
        : (await api.get(`/llm/data-extraction/${documentId}`)).data;
      return documentExtractionEnvelopeSchema.parse(data);
    },
  });

export const extractDocument = () =>
  mutationOptions({
    mutationFn: async (input: {
      documentId: string;
      paragraphs: string[];
      fileName?: string | null;
      useCache?: boolean;
      signal?: AbortSignal;
    }) => {
      const data = USE_MOCK_DATA_EXTRACTION
        ? await mock.mockExtractDocument(input)
        : (
            await api.post(
              "/llm/data-extraction",
              {
                document: {
                  document_id: input.documentId,
                  document: input.paragraphs,
                  file_name: input.fileName ?? null,
                },
              },
              {
                params: { use_cache: input.useCache ?? true },
                signal: input.signal,
              },
            )
          ).data;
      return dataExtractionPredictionSchema.parse(data);
    },
  });

export const validateRecommendation = () =>
  mutationOptions({
    mutationFn: async (input: {
      documentId: string;
      payload: RecommendationValidationInput;
    }) => {
      const data = USE_MOCK_DATA_EXTRACTION
        ? await mock.mockValidateRecommendation(input)
        : (
            await api.put(
              `/llm/data-extraction/${input.documentId}/validate`,
              input.payload,
            )
          ).data;
      return recommendationValidationSchema.parse(data);
    },
  });

export const recommendationsList = (params: {
  page?: number;
  pageSize?: number;
  orderBy?: string;
  orderDir?: "asc" | "desc";
  unparsedDates?: boolean;
  q?: string;
  topicId?: string;
  sectorId?: string;
  dateFrom?: string;
  dateTo?: string;
}) =>
  queryOptions({
    queryKey: ["recommendations-list", params, api.defaults.baseURL],
    queryFn: async () => {
      const data = USE_MOCK_DATA_EXTRACTION
        ? await mock.mockRecommendationsList(params)
        : (
            await api.get("/llm/data-extraction/recommendations", {
              params: {
                page: params.page,
                page_size: params.pageSize,
                order_by: params.orderBy,
                order_dir: params.orderDir,
                unparsed_dates: params.unparsedDates,
                q: params.q,
                topic_id: params.topicId,
                sector_id: params.sectorId,
                date_from: params.dateFrom,
                date_to: params.dateTo,
              },
            })
          ).data;
      return recommendationPageSchema.parse(data);
    },
  });

export const recommendationEnums = () =>
  queryOptions({
    queryKey: ["recommendation-enums", api.defaults.baseURL],
    queryFn: async () => {
      const data = USE_MOCK_DATA_EXTRACTION
        ? await mock.mockRecommendationEnums()
        : (await api.get("/catalogs/recommendation-enums")).data;
      return recommendationEnumsSchema.parse(data);
    },
  });

export const patchRecommendationSeguimiento = () =>
  mutationOptions({
    mutationFn: async (input: {
      recommendationId: string;
      payload: Partial<{
        file_number: string | null;
        recommendation_detail: string | null;
        recommendation_situation: string | null;
        status: string | null;
        approved_for_publication: boolean | null;
        link: string | null;
      }>;
    }) => {
      const data = USE_MOCK_DATA_EXTRACTION
        ? await mock.mockPatchRecommendationSeguimiento(input)
        : (
            await api.patch(
              `/llm/data-extraction/recommendations/${input.recommendationId}`,
              input.payload,
            )
          ).data;
      return recommendationRowSchema.parse(data);
    },
  });

function filenameFromContentDisposition(
  header: string | undefined,
  fallback: string,
): string {
  const match = header?.match(/filename="?([^"]+)"?/);
  if (!match?.[1]) {
    console.warn(
      "Content-Disposition header missing or unparseable; falling back to a generic export filename. Check CORS_ORIGINS.",
    );
    return fallback;
  }
  return match[1];
}

export interface RecommendationsExportResult {
  blob: Blob;
  fileName: string;
}

export const downloadRecommendationsExport = () =>
  mutationOptions({
    mutationFn: async (
      format: "xlsx" | "csv" = "xlsx",
    ): Promise<RecommendationsExportResult> => {
      if (USE_MOCK_DATA_EXTRACTION) {
        return mock.mockDownloadRecommendationsExport(format);
      }
      const response = await api.get("/llm/data-extraction/export", {
        params: { format },
        responseType: "blob",
      });
      return {
        blob: response.data as Blob,
        fileName: filenameFromContentDisposition(
          response.headers["content-disposition"],
          `recomendaciones.${format}`,
        ),
      };
    },
  });
