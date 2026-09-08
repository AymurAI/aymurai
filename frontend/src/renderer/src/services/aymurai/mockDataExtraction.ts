import type {
  DataExtractionPrediction,
  DocumentExtractionEnvelope,
  RecipientDetail,
  RecommendationValidation,
  RecommendationValidationInput,
} from "@/types/dataExtraction";
import { parseSpanishProseDate } from "@/utils/recommendations/parse-spanish-date";

const now = "2026-08-28T00:00:00Z";

const MOCK_DELAY_MS = 200;
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(value), MOCK_DELAY_MS),
  );
}

let nextId = 100;
function makeId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

/**
 * Resolves the `unit_name`/`sector_name` a validated recipient shows, without
 * pulling in the real organigram service. Seeded from the same
 * `unit_id`/`sector_id` pairs the sample prediction below hands out as
 * `sector_candidates`, so choosing one of those ids in the Task 11 form
 * round-trips through `validateRecommendation` with a real-looking name
 * instead of nulling both fields.
 */
const UNIT_NAMES: Record<string, string> = {
  "unit-201": "Dirección General de Administración",
  "unit-202": "Dirección General de Recursos Humanos",
  "unit-203": "Dirección General Técnica Administrativa",
};
const SECTOR_NAMES: Record<string, string> = {
  "sector-10": "Ministerio de Educación",
  "sector-11": "Ministerio de Hacienda y Finanzas",
  "sector-12": "Ministerio de Justicia y Seguridad",
};

/**
 * Sample extraction, keyed by `documentId` — mirrors the real endpoint's
 * cache: the same document asked twice returns the same prediction.
 *
 * Two recipients on purpose, contrasting the two shapes Task 12 exercises:
 * a GCBA recipient with several ranked `sector_candidates` (an ambiguous
 * match a human picks from) and a non-GCBA recipient with none (nothing in
 * the organigram plausibly matches, so there is nothing to rank).
 */
function samplePrediction(documentId: string): DataExtractionPrediction {
  return {
    document_id: documentId,
    recommendation_number: "123/2026",
    recommendation_date: "22 de noviembre",
    recipients: [
      {
        name: "Juan Pérez",
        position: "Director General",
        is_primary: true,
        macro_sector: "GCBA",
        unit_id: null,
        unit_name: null,
        sector_id: null,
        sector_name: null,
        match_method: "cargo",
        sector_candidates: [
          {
            unit_id: "unit-201",
            unit_name: UNIT_NAMES["unit-201"],
            sector_id: "sector-10",
            sector_name: SECTOR_NAMES["sector-10"],
            ruta_organigrama:
              "GCBA > Ministerio de Educación > Dirección General de Administración",
            score: 0.92,
          },
          {
            unit_id: "unit-202",
            unit_name: UNIT_NAMES["unit-202"],
            sector_id: "sector-11",
            sector_name: SECTOR_NAMES["sector-11"],
            ruta_organigrama:
              "GCBA > Ministerio de Hacienda y Finanzas > Dirección General de Recursos Humanos",
            score: 0.81,
          },
          {
            unit_id: "unit-203",
            unit_name: UNIT_NAMES["unit-203"],
            sector_id: "sector-12",
            sector_name: SECTOR_NAMES["sector-12"],
            ruta_organigrama:
              "GCBA > Ministerio de Justicia y Seguridad > Dirección General Técnica Administrativa",
            score: 0.67,
          },
        ],
      },
      {
        name: "María Gómez",
        position: "Presidenta",
        is_primary: false,
        macro_sector: "Poder Judicial",
        unit_id: null,
        unit_name: null,
        sector_id: null,
        sector_name: null,
        match_method: null,
        sector_candidates: [],
      },
    ],
    topic: "Salud",
    subtopic: "Acceso a medicamentos",
    personal_data: false,
    publishable_content:
      "La Defensoría recomienda al organismo destinatario que arbitre los medios necesarios para garantizar el acceso a medicamentos esenciales.",
    config: {
      model: "mock-model",
      options: { max_tokens: 2048, attempts: 1 },
      catalogs_hash: "mock-hash",
    },
    catalogs_stale: false,
  };
}

const predictions = new Map<string, DataExtractionPrediction>();
const validations = new Map<string, RecommendationValidation>();

export function mockDocumentExtractionEnvelope(
  documentId: string,
): Promise<DocumentExtractionEnvelope> {
  const prediction = predictions.get(documentId) ?? null;
  const validation = validations.get(documentId) ?? null;
  return delay({
    document_id: documentId,
    prediction,
    validation,
    catalogs_stale: false,
    updated_at: prediction || validation ? now : null,
  });
}

export function mockExtractDocument(input: {
  documentId: string;
  paragraphs: string[];
  useCache?: boolean;
}): Promise<DataExtractionPrediction> {
  const useCache = input.useCache ?? true;
  const existing = predictions.get(input.documentId);
  if (useCache && existing) return delay(existing);

  const created = samplePrediction(input.documentId);
  predictions.set(input.documentId, created);
  return delay(created);
}

export function mockValidateRecommendation(input: {
  documentId: string;
  payload: RecommendationValidationInput;
}): Promise<RecommendationValidation> {
  const existing = validations.get(input.documentId);
  const recipients: RecipientDetail[] = input.payload.recipients.map((r) => ({
    id: r.id ?? makeId("recipient"),
    source_index: r.source_index ?? null,
    name: r.name,
    position: r.position,
    is_primary: r.is_primary,
    macro_sector: r.macro_sector,
    unit_id: r.unit_id,
    unit_name: r.unit_id ? (UNIT_NAMES[r.unit_id] ?? null) : null,
    sector_id: r.sector_id,
    sector_name: r.sector_id ? (SECTOR_NAMES[r.sector_id] ?? null) : null,
  }));

  const prediction = predictions.get(input.documentId);
  const created: RecommendationValidation = {
    id: existing?.id ?? makeId("recommendation"),
    document_id: input.documentId,
    recommendation_number: input.payload.recommendation_number,
    recommendation_date_text: input.payload.recommendation_date_text,
    // Mirrors `recommendation_upsert` (`aymurai/database/crud/recommendation.py`):
    // the explicit override wins when given, else re-derive from the prose
    // text on every save -- never falls back to the previously stored value,
    // so an edited `recommendation_date_text` with no picker override keeps
    // re-parsing instead of going stale.
    recommendation_date:
      input.payload.recommendation_date ??
      parseSpanishProseDate(input.payload.recommendation_date_text),
    topic: input.payload.topic,
    subtopic: input.payload.subtopic,
    personal_data: input.payload.personal_data,
    publishable_content: input.payload.publishable_content,
    recipients,
    source_text: existing?.source_text ?? "",
    prediction: (prediction as unknown as Record<string, unknown>) ?? {},
  };
  validations.set(input.documentId, created);
  return delay(created);
}

/**
 * Minimal placeholder file — enough for the download flow to exercise a real
 * `Blob` end to end without depending on a real xlsx/csv writer in the mock.
 */
export function mockDownloadRecommendationsExport(
  format: "xlsx" | "csv",
): Promise<Blob> {
  const type =
    format === "csv"
      ? "text/csv"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const placeholder =
    format === "csv"
      ? "recommendation_number,topic,subtopic\n123/2026,Salud,Acceso a medicamentos\n"
      : "mock xlsx placeholder";
  return delay(new Blob([placeholder], { type }));
}
