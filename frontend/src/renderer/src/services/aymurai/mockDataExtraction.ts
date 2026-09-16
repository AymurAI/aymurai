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
  ivc: "Instituto de Vivienda de la Ciudad",
  dgpolea: "Dirección General Política y Estrategia Ambiental",
  mhfgc: "Ministerio de Hacienda y Finanzas",
};
const SECTOR_NAMES: Record<string, string> = {
  ivc: "Instituto de Vivienda de la Ciudad",
  avig: "Vicejefatura de Gobierno",
  mhfgc: "Ministerio de Hacienda y Finanzas",
};

/**
 * Sample extraction, keyed by `documentId` — mirrors the real endpoint's
 * cache: the same document asked twice returns the same prediction.
 *
 * Three recipients on purpose, one per shape the unit/sector pair can take:
 * a unit that IS its own sector (IVC), a unit whose sector is an ancestor
 * (a dirección under the Vicejefatura), and a non-GCBA recipient with no
 * organigram at all. Ids are real nodes of `fixtures/organigram.json` (the
 * actual GCBA tree), so client-side sector resolution works in mock mode.
 *
 * Candidates follow the real shape (ADR-0008): each row IS a sector, so
 * `unit_id === sector_id`, `ruta_organigrama` is the sector's own path, and
 * the unit that produced it travels in `source_unit_id`.
 */
function samplePrediction(documentId: string): DataExtractionPrediction {
  return {
    document_id: documentId,
    recommendation_number: "123/2026",
    recommendation_date: "22 de noviembre",
    recipients: [
      // Unidad que ES su propio sector: IVC es un organismo autónomo
      // (`is_sector`, ADR-0001) y además una hoja del árbol, así que la
      // unidad inferida del cargo y el sector que la contiene son el mismo
      // nodo. Los dos campos del formulario muestran IVC.
      {
        name: "Gabriel Mraida",
        position:
          "Presidente del Instituto de Vivienda de la Ciudad Autónoma de Buenos Aires",
        is_primary: true,
        macro_sector: "GCBA",
        unit_id: "ivc",
        unit_name: UNIT_NAMES.ivc,
        sector_id: "ivc",
        sector_name: SECTOR_NAMES.ivc,
        match_method: "cargo",
        unit_candidates: [],
        sector_candidates: [
          {
            unit_id: "ivc",
            unit_name: SECTOR_NAMES.ivc,
            sector_id: "ivc",
            sector_name: SECTOR_NAMES.ivc,
            ruta_organigrama:
              "Jefe de Gobierno > Jefatura de Gabinete de Ministros > Ministerio de Desarrollo Humano y Hábitat > Instituto de Vivienda de la Ciudad",
            score: 94.2,
            source_unit_id: "ivc",
            source_unit_name: UNIT_NAMES.ivc,
          },
          {
            unit_id: "avig",
            unit_name: SECTOR_NAMES.avig,
            sector_id: "avig",
            sector_name: SECTOR_NAMES.avig,
            ruta_organigrama: "Jefe de Gobierno > Vicejefatura de Gobierno",
            score: 61.0,
            source_unit_id: "dgpolea",
            source_unit_name: UNIT_NAMES.dgpolea,
          },
        ],
      },
      // Unidad distinta de su sector: la dirección general cuelga de una
      // subsecretaría que no es sector, así que el recorrido sigue hasta la
      // Vicejefatura. Unidad y "Destinatario por sector" difieren.
      {
        name: "Ana Pérez",
        position: "Directora General Política y Estrategia Ambiental",
        is_primary: false,
        macro_sector: "GCBA",
        unit_id: "dgpolea",
        unit_name: UNIT_NAMES.dgpolea,
        sector_id: "avig",
        sector_name: SECTOR_NAMES.avig,
        match_method: "cargo",
        // The ranking uncollapsed: three units of the same sector, which is
        // what the unit field offers (in this order) once that sector is
        // validated. `sector_candidates` below keeps only the best of them.
        unit_candidates: [
          {
            unit_id: "dgpolea",
            unit_name: UNIT_NAMES.dgpolea,
            sector_id: "avig",
            sector_name: SECTOR_NAMES.avig,
            ruta_organigrama:
              "Jefe de Gobierno > Vicejefatura de Gobierno > Subsecretaría de Ambiente > Dirección General Política y Estrategia Ambiental",
            score: 88.4,
          },
          {
            unit_id: "dgacra",
            unit_name:
              "Dirección General Áreas de Conservación y Restauración Ambiental",
            sector_id: "avig",
            sector_name: SECTOR_NAMES.avig,
            ruta_organigrama:
              "Jefe de Gobierno > Vicejefatura de Gobierno > Subsecretaría de Ambiente > Dirección General Áreas de Conservación y Restauración Ambiental",
            score: 63.2,
          },
          {
            unit_id: "dgdsec",
            unit_name:
              "Dirección General Desarrollo Sostenible y Economía Circular",
            sector_id: "avig",
            sector_name: SECTOR_NAMES.avig,
            ruta_organigrama:
              "Jefe de Gobierno > Vicejefatura de Gobierno > Subsecretaría de Ambiente > Dirección General Desarrollo Sostenible y Economía Circular",
            score: 55.1,
          },
        ],
        sector_candidates: [
          {
            unit_id: "avig",
            unit_name: SECTOR_NAMES.avig,
            sector_id: "avig",
            sector_name: SECTOR_NAMES.avig,
            ruta_organigrama: "Jefe de Gobierno > Vicejefatura de Gobierno",
            score: 88.4,
            source_unit_id: "dgpolea",
            source_unit_name: UNIT_NAMES.dgpolea,
          },
          {
            unit_id: "mhfgc",
            unit_name: SECTOR_NAMES.mhfgc,
            sector_id: "mhfgc",
            sector_name: SECTOR_NAMES.mhfgc,
            ruta_organigrama:
              "Jefe de Gobierno > Jefatura de Gabinete de Ministros > Ministerio de Hacienda y Finanzas",
            score: 52.3,
            source_unit_id: "mhfgc",
            source_unit_name: UNIT_NAMES.mhfgc,
          },
        ],
      },
      // Sin organigrama: fuera del GCBA no hay unidad ni sector que validar,
      // y el "Destinatario por sector" del export es el Ámbito.
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
        unit_candidates: [],
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
