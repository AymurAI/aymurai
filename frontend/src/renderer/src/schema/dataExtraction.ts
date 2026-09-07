import { z } from "zod";

/** Mirrors `OrganigramCandidateResponse` in `aymurai/api/endpoints/schemas/responses/data_extraction.py`. */
export const organigramCandidateSchema = z.object({
  unit_id: z.string(),
  unit_name: z.string(),
  sector_id: z.string().nullable(),
  sector_name: z.string().nullable(),
  ruta_organigrama: z.string(),
  score: z.number(),
});

/** Mirrors `RecipientResponse`. */
export const recipientPredictionSchema = z.object({
  name: z.string().nullable(),
  position: z.string().nullable(),
  is_primary: z.boolean(),
  macro_sector: z.string().nullable(),
  unit_id: z.string().nullable(),
  unit_name: z.string().nullable(),
  sector_id: z.string().nullable(),
  sector_name: z.string().nullable(),
  match_method: z.enum(["cargo", "name"]).nullable(),
  sector_candidates: z.array(organigramCandidateSchema),
});

/** Mirrors `DataExtractionConfigResponse`. */
export const dataExtractionConfigSchema = z.object({
  model: z.string(),
  options: z.record(z.string(), z.unknown()),
  catalogs_hash: z.string(),
});

/** Mirrors `DataExtractionResponse`. */
export const dataExtractionPredictionSchema = z.object({
  document_id: z.string(),
  recommendation_number: z.string().nullable(),
  recommendation_date: z.string().nullable(),
  recipients: z.array(recipientPredictionSchema),
  topic: z.string().nullable(),
  subtopic: z.string().nullable(),
  personal_data: z.boolean().nullable(),
  publishable_content: z.string(),
  config: dataExtractionConfigSchema,
  catalogs_stale: z.boolean(),
});

/** Mirrors `RecipientDetailResponse`. */
export const recipientDetailSchema = z.object({
  id: z.string(),
  source_index: z.number().nullable(),
  name: z.string().nullable(),
  position: z.string().nullable(),
  is_primary: z.boolean(),
  macro_sector: z.string().nullable(),
  unit_id: z.string().nullable(),
  unit_name: z.string().nullable(),
  sector_id: z.string().nullable(),
  sector_name: z.string().nullable(),
});

/** Mirrors `RecommendationDetailResponse`. */
export const recommendationValidationSchema = z.object({
  id: z.string(),
  document_id: z.string(),
  recommendation_number: z.string().nullable(),
  recommendation_date_text: z.string().nullable(),
  recommendation_date: z.string().nullable(),
  topic: z.string().nullable(),
  subtopic: z.string().nullable(),
  personal_data: z.boolean().nullable(),
  publishable_content: z.string(),
  recipients: z.array(recipientDetailSchema),
  source_text: z.string(),
  prediction: z.record(z.string(), z.unknown()),
});

/** Mirrors `DocumentExtractionEnvelopeResponse`. */
export const documentExtractionEnvelopeSchema = z.object({
  document_id: z.string(),
  prediction: dataExtractionPredictionSchema.nullable(),
  validation: recommendationValidationSchema.nullable(),
  catalogs_stale: z.boolean(),
  updated_at: z.string().nullable(),
});
