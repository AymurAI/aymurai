import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { USE_MOCK_DATA_EXTRACTION } from "@/constants/config";
import {
  dataExtractionPredictionSchema,
  documentExtractionEnvelopeSchema,
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

export const downloadRecommendationsExport = () =>
  mutationOptions({
    mutationFn: async (format: "xlsx" | "csv" = "xlsx") => {
      const response = await api.get("/llm/data-extraction/export", {
        params: { format },
        responseType: "blob",
      });
      return response.data as Blob;
    },
  });
