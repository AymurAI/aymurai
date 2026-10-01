import { z } from "zod";

/** Mirrors `OrganigramCandidateResponse` in `aymurai/api/endpoints/schemas/responses/data_extraction.py`. */
export const organigramCandidateSchema = z.object({
  // A candidate IS a sector, not a unit (ADR-0008): units are ranked against
  // the cargo and then collapsed to the sector each one resolves to, so
  // `unit_id` and `sector_id` are both the sector's own id by construction.
  // The unit that actually produced the row is `source_unit_id` -- that is
  // what goes back as `unit_id` on validate.
  unit_id: z.string(),
  unit_name: z.string(),
  sector_id: z.string().nullable(),
  sector_name: z.string().nullable(),
  ruta_organigrama: z.string(),
  score: z.number(),
  source_unit_id: z.string().nullable(),
  source_unit_name: z.string().nullable(),
});

/** Mirrors `OrganigramUnitCandidateResponse`. */
export const organigramUnitCandidateSchema = z.object({
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
  unit_candidates: z.array(organigramUnitCandidateSchema).default([]),
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

/**
 * Mirrors `RecommendationResponse` -- the row shape `GET
 * /llm/data-extraction/recommendations` serves for the grilla. A sibling of
 * `recommendationValidationSchema` (which mirrors `RecommendationDetailResponse`,
 * the `source_text`/`prediction` superset returned by the single-document
 * validate/detail endpoints): reuses that schema's shared base fields via
 * `.omit()` + `.extend()` rather than duplicating them, and adds the six
 * post-publication seguimiento fields plus `created_at`/`updated_at` the
 * backend started serving in Task 1.
 */
export const recommendationRowSchema = recommendationValidationSchema
  .omit({ source_text: true, prediction: true })
  .extend({
    file_number: z.string().nullable(),
    recommendation_detail: z.string().nullable(),
    recommendation_situation: z.string().nullable(),
    status: z.string().nullable(),
    approved_for_publication: z.boolean().nullable(),
    link: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string().nullable(),
  });

/** Mirrors `RecommendationPageResponse`. */
export const recommendationPageSchema = z.object({
  items: z.array(recommendationRowSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

/** Mirrors `RecommendationEnumsResponse` (`GET /catalogs/recommendation-enums`). */
export const recommendationEnumsSchema = z.object({
  situations: z.array(z.string()),
  statuses: z.array(z.string()),
});
