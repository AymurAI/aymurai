import { z } from "zod";
import { dataExtractionPredictionSchema } from "@/schema/dataExtraction";
import type {
  DataExtractionPrediction,
  RecommendationDetail,
} from "@/types/dataExtraction";

/**
 * `RecommendationDetail.prediction` is NOT a `DataExtractionResponse` (what
 * `dataExtractionPredictionSchema` mirrors, and what `POST /data-extraction`
 * returns) -- confirmed empirically against a real extract-validate-correct
 * cycle. It is `RawExtraction.model_dump()`
 * (`aymurai/api/endpoints/routers/llm/data_extraction_engine.py`), the raw,
 * unresolved LLM output the backend persists: no `document_id`/`config`/
 * `catalogs_stale`, and each recipient without the organigram resolution
 * (`unit_id`/`unit_name`/`sector_id`/`sector_name`/`match_method`/
 * `sector_candidates`/`unit_candidates`) that only happens at
 * response-serialization time (`_response_from_record`/`_recipient_response`
 * in `aymurai/api/endpoints/routers/defensoria/data_extraction.py`), never at
 * write time. This schema matches what is genuinely stored.
 */
const storedPredictionSchema = z.object({
  recommendation_number: z.string().nullable(),
  recommendation_date: z.string().nullable(),
  recipients: z.array(
    z.object({
      name: z.string().nullable(),
      position: z.string().nullable(),
      is_primary: z.boolean(),
      macro_sector: z.string().nullable(),
    }),
  ),
  topic: z.string().nullable(),
  subtopic: z.string().nullable(),
  personal_data: z.boolean().nullable(),
  publishable_content: z.string(),
});

/**
 * Reconstructs a typed `DataExtractionPrediction` from a `RecommendationDetail`
 * so the correction screen can reuse the same suggestion-overlay components
 * as the live extraction wizard, without a second, narrower prediction type
 * threaded through the app.
 *
 * `detail.prediction` only ever holds the stored, unresolved shape (see
 * `storedPredictionSchema` above) -- the fields that genuinely are not
 * preserved get honest, visible defaults instead of a silent cast:
 * `document_id` is filled from the detail row itself (the one place it IS
 * preserved); `config`/`catalogs_stale` are inert here (`config` only matters
 * for the wizard's live re-extraction remount key, and re-extracting from the
 * correction screen is out of scope for this tajada; `catalogs_stale` has
 * nothing to check against on a stored recommendation); and every recipient's
 * organigram resolution defaults to "unresolved" (`unit_id: null`,
 * `sector_candidates: []`, etc.) -- the actual, corrected organigram
 * assignment lives on `detail.recipients` (`RecipientDetail[]`, always fully
 * resolved server-side), never on this frozen suggestion overlay.
 */
export function predictionFromDetail(
  detail: RecommendationDetail,
): DataExtractionPrediction {
  const stored = storedPredictionSchema.parse(detail.prediction);
  return dataExtractionPredictionSchema.parse({
    document_id: detail.document_id,
    recommendation_number: stored.recommendation_number,
    recommendation_date: stored.recommendation_date,
    recipients: stored.recipients.map((recipient) => ({
      ...recipient,
      unit_id: null,
      unit_name: null,
      sector_id: null,
      sector_name: null,
      match_method: null,
      sector_candidates: [],
      unit_candidates: [],
    })),
    topic: stored.topic,
    subtopic: stored.subtopic,
    personal_data: stored.personal_data,
    publishable_content: stored.publishable_content,
    config: { model: "", options: {}, catalogs_hash: "" },
    catalogs_stale: false,
  });
}
