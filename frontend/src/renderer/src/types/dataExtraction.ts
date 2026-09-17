/**
 * A ranked SECTOR, not a unit (ADR-0008): the backend matches the cargo
 * against units and then collapses each match to the sector it resolves to,
 * keeping the best score per sector. So `unit_id === sector_id` on every row,
 * and `ruta_organigrama` is the sector's own path.
 *
 * `source_unit_*` is the unit whose match produced this sector. Submitting
 * `unit_id = source_unit_id` together with this row's `sector_id` is the
 * pairing the server's consistency check is guaranteed to accept, since it is
 * exactly how the candidate was derived.
 */
export interface OrganigramCandidate {
  unit_id: string;
  unit_name: string;
  sector_id: string | null;
  sector_name: string | null;
  ruta_organigrama: string;
  score: number;
  source_unit_id: string | null;
  source_unit_name: string | null;
}

/**
 * One ranked UNIT match, before the collapse to sectors that produces
 * `OrganigramCandidate`. Here every field means what it says: `unit_id` is
 * the unit, `sector_id` the sector containing it, `ruta_organigrama` the
 * unit's own path.
 *
 * Wider than `sector_candidates` on purpose: filtering these to one
 * validated sector is what lets the unit field offer that sector's units in
 * the backend's own similarity order, which is not reproducible here.
 */
export interface OrganigramUnitCandidate {
  unit_id: string;
  unit_name: string;
  sector_id: string | null;
  sector_name: string | null;
  ruta_organigrama: string;
  score: number;
}

export interface RecipientPrediction {
  name: string | null;
  position: string | null;
  is_primary: boolean;
  macro_sector: string | null;
  /** Cross-referenced against the organigram; null when nothing cleared the match threshold. */
  unit_id: string | null;
  unit_name: string | null;
  sector_id: string | null;
  sector_name: string | null;
  match_method: "cargo" | "name" | null;
  /** Ranked alternatives regardless of whether `unit_id` cleared the match threshold. */
  sector_candidates: OrganigramCandidate[];
  /** The same ranking uncollapsed and wider -- see `OrganigramUnitCandidate`. */
  unit_candidates: OrganigramUnitCandidate[];
}

export interface DataExtractionConfig {
  model: string;
  options: Record<string, unknown>;
  catalogs_hash: string;
}

export interface DataExtractionPrediction {
  document_id: string;
  recommendation_number: string | null;
  recommendation_date: string | null;
  recipients: RecipientPrediction[];
  topic: string | null;
  subtopic: string | null;
  personal_data: boolean | null;
  publishable_content: string;
  config: DataExtractionConfig;
  /** True when `config.catalogs_hash` no longer matches the live catalogs snapshot. */
  catalogs_stale: boolean;
}

export interface RecipientDetail {
  id: string;
  /** Index into `prediction.recipients`; null when a person added this one. */
  source_index: number | null;
  name: string | null;
  position: string | null;
  is_primary: boolean;
  macro_sector: string | null;
  unit_id: string | null;
  unit_name: string | null;
  sector_id: string | null;
  sector_name: string | null;
}

export interface RecommendationValidation {
  id: string;
  document_id: string;
  recommendation_number: string | null;
  recommendation_date_text: string | null;
  recommendation_date: string | null;
  topic: string | null;
  subtopic: string | null;
  personal_data: boolean | null;
  publishable_content: string;
  recipients: RecipientDetail[];
  source_text: string;
  prediction: Record<string, unknown>;
}

export interface DocumentExtractionEnvelope {
  document_id: string;
  prediction: DataExtractionPrediction | null;
  validation: RecommendationValidation | null;
  catalogs_stale: boolean;
  updated_at: string | null;
}

export interface RecipientValidationInput {
  /** Present when correcting an already-saved recipient, absent for a new one. */
  id?: string | null;
  /** Index into `extraction.prediction.recipients`; null when the person added it by hand. */
  source_index?: number | null;
  name: string | null;
  position: string | null;
  is_primary: boolean;
  macro_sector: string | null;
  unit_id: string | null;
  sector_id: string | null;
}

export interface RecommendationValidationInput {
  recommendation_number: string | null;
  recommendation_date_text: string | null;
  recommendation_date: string | null;
  topic: string | null;
  subtopic: string | null;
  personal_data: boolean | null;
  publishable_content: string;
  recipients: RecipientValidationInput[];
}

export interface RecipientFormValues {
  /** Present only for a recipient already saved on the server. */
  id: string | null;
  /** Index into `prediction.recipients`; null when a person added this one. */
  source_index: number | null;
  name: string | null;
  position: string | null;
  is_primary: boolean;
  macro_sector: string | null;
  unit_id: string | null;
  sector_id: string | null;
}

export interface RecommendationFormValues {
  recommendation_number: string | null;
  /** Free prose, not a date: the model returns things like "22 de noviembre". */
  recommendation_date_text: string | null;
  /** `YYYY-MM-DD` for the native date input, or `null` for its empty state. */
  recommendation_date: string | null;
  topic: string | null;
  subtopic: string | null;
  /** Tri-state: null means the question was not answered. */
  personal_data: boolean | null;
  publishable_content: string;
  recipients: RecipientFormValues[];
}

export interface FormOption {
  value: string;
  label: string;
  /** Returned by the model but absent from the catalog: kept and flagged. */
  outOfCatalog: boolean;
}
