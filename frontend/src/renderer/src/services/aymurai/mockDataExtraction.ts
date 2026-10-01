import { AxiosError } from "axios";
import type {
  DataExtractionPrediction,
  DocumentExtractionEnvelope,
  RecipientDetail,
  RecommendationDetail,
  RecommendationEnums,
  RecommendationPage,
  RecommendationRow,
  RecommendationValidation,
  RecommendationValidationInput,
} from "@/types/dataExtraction";
import { parseSpanishProseDate } from "@/utils/recommendations/parse-spanish-date";
import type { RecommendationsExportResult } from "./dataExtraction";
import {
  mockListMacroSectors,
  mockListSubtopics,
  mockListTopics,
} from "./mockCatalogs";

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
 * Copied string literals of `RecommendationSituation`/`RecommendationStatus`
 * (`aymurai/database/meta/recommendation.py`) — the mock has no Python
 * import, so `GET /catalogs/recommendation-enums` is reproduced by hand here.
 */
const RECOMMENDATION_SITUATIONS = [
  "Respuesta",
  "Respuesta parcial",
  "Notificado",
];
const RECOMMENDATION_STATUSES = ["Solucionado", "No solucionado"];

/**
 * Seed rows for the recommendations grilla (Task 5), keyed by `id`. Two rows
 * on purpose: one fully worked (a parsed date, a situation, no status yet)
 * and one still needing attention (date prose that did not parse, no
 * seguimiento fields set), so `unparsedDates`/empty-state UI has something
 * real to show against.
 */
const recommendationRows = new Map<string, RecommendationDetail>([
  [
    "recommendation-1",
    {
      id: "recommendation-1",
      document_id: "document-1",
      recommendation_number: "123/2026",
      recommendation_date_text: "22 de noviembre",
      recommendation_date: "2026-11-22",
      topic: "Salud",
      subtopic: "Acceso a medicamentos",
      personal_data: false,
      publishable_content:
        "La Defensoría recomienda al organismo destinatario que arbitre los medios necesarios para garantizar el acceso a medicamentos esenciales.",
      recipients: [],
      file_number: "EX-2026-00123",
      recommendation_detail: null,
      recommendation_situation: "Notificado",
      status: null,
      approved_for_publication: null,
      link: null,
      created_at: now,
      updated_at: null,
      source_text:
        "El organismo destinatario deberá arbitrar los medios necesarios para garantizar el acceso a medicamentos esenciales a la población afectada.",
      // Deliberately the RAW extraction shape (`RawExtraction.model_dump()`
      // in `aymurai/api/endpoints/routers/llm/data_extraction_engine.py`),
      // NOT `DataExtractionPrediction` -- the backend stores this narrower
      // dict (no `document_id`/`config`/`catalogs_stale`, and recipients
      // without the resolved organigram fields), confirmed empirically
      // against a real extract→validate→correct cycle. See task-2-report.md
      // for why `predictionFromDetail` (Task 2 item 5) was not implemented
      // against `dataExtractionPredictionSchema`.
      prediction: {
        recommendation_number: "123/2026",
        recommendation_date: "22 de noviembre",
        recipients: [],
        topic: "Salud",
        subtopic: "Acceso a medicamentos",
        personal_data: false,
        publishable_content:
          "La Defensoría recomienda al organismo destinatario que arbitre los medios necesarios para garantizar el acceso a medicamentos esenciales.",
      },
    },
  ],
  [
    "recommendation-2",
    {
      id: "recommendation-2",
      document_id: "document-2",
      recommendation_number: "456/2026",
      // Prose the model read but could not parse -- what an "unparsed date"
      // actually is, and what the `unparsedDates` filter looks for (text
      // present, no parsed date). A row with neither was never a date to
      // interpret and the real endpoint would not return it here.
      recommendation_date_text: "durante el pasado mes",
      recommendation_date: null,
      topic: "Vivienda",
      subtopic: null,
      personal_data: null,
      publishable_content:
        "La Defensoría recomienda al organismo destinatario que agilice el trámite de la solicitud de vivienda.",
      recipients: [],
      file_number: null,
      recommendation_detail: null,
      recommendation_situation: null,
      status: "Solucionado",
      approved_for_publication: true,
      link: "https://example.org/recomendacion-456",
      created_at: now,
      updated_at: now,
      source_text:
        "Durante el pasado mes se recibieron reclamos por demoras en el trámite de solicitudes de vivienda social.",
      prediction: {
        recommendation_number: "456/2026",
        recommendation_date: "durante el pasado mes",
        recipients: [],
        topic: "Vivienda",
        subtopic: null,
        personal_data: null,
        publishable_content:
          "La Defensoría recomienda al organismo destinatario que agilice el trámite de la solicitud de vivienda.",
      },
    },
  ],
]);

export async function mockRecommendationsList(params: {
  page?: number;
  pageSize?: number;
  orderBy?: string;
  orderDir?: "asc" | "desc";
  unparsedDates?: boolean;
  q?: string;
  topicId?: string;
  subtopicId?: string;
  sectorId?: string;
  macroSectorId?: string;
  recommendationSituation?: string;
  status?: string;
  approvedForPublication?: boolean;
  publicationUnanswered?: boolean;
  dateFrom?: string;
  dateTo?: string;
  editedFrom?: string;
  editedTo?: string;
}): Promise<RecommendationPage> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;

  let rows = Array.from(recommendationRows.values());

  if (params.unparsedDates) {
    // Both halves, exactly as the real filter does it: prose the model read
    // but could not parse. A row with no date text at all was never a date
    // to interpret, so it is not one a human has to correct.
    rows = rows.filter(
      (r) =>
        r.recommendation_date_text !== null && r.recommendation_date === null,
    );
  }
  if (params.q) {
    const q = params.q.toLowerCase();
    rows = rows.filter((r) =>
      [
        r.recommendation_number,
        r.file_number,
        r.recommendation_detail,
        r.publishable_content,
        r.topic,
        r.subtopic,
        r.link,
        ...r.recipients.flatMap((recipient) => [
          recipient.name,
          recipient.position,
          recipient.unit_name,
          recipient.sector_name,
          recipient.macro_sector,
        ]),
      ].some((field) => field?.toLowerCase().includes(q)),
    );
  }
  if (params.topicId) {
    const topic = (await mockListTopics()).find((t) => t.id === params.topicId);
    rows = rows.filter((r) => topic !== undefined && r.topic === topic.name);
  }
  if (params.subtopicId) {
    const subtopic = (await mockListSubtopics(params.topicId ?? "")).find(
      (item) => item.id === params.subtopicId,
    );
    rows = rows.filter(
      (row) => subtopic !== undefined && row.subtopic === subtopic.name,
    );
  }
  if (params.sectorId) {
    rows = rows.filter((r) =>
      r.recipients.some((recipient) => recipient.sector_id === params.sectorId),
    );
  }
  if (params.macroSectorId) {
    const macroSector = (await mockListMacroSectors()).find(
      (sector) => sector.id === params.macroSectorId,
    );
    rows = rows.filter(
      (r) =>
        macroSector !== undefined &&
        r.recipients.some(
          (recipient) => recipient.macro_sector === macroSector.name,
        ),
    );
  }
  if (params.recommendationSituation !== undefined) {
    rows = rows.filter(
      (r) => r.recommendation_situation === params.recommendationSituation,
    );
  }
  if (params.status !== undefined) {
    rows = rows.filter((r) => r.status === params.status);
  }
  if (params.approvedForPublication !== undefined) {
    rows = rows.filter(
      (r) => r.approved_for_publication === params.approvedForPublication,
    );
  }
  if (params.publicationUnanswered) {
    rows = rows.filter((r) => r.approved_for_publication === null);
  }
  const dateFrom = params.dateFrom;
  if (dateFrom) {
    rows = rows.filter(
      (r) =>
        r.recommendation_date !== null && r.recommendation_date >= dateFrom,
    );
  }
  const dateTo = params.dateTo;
  if (dateTo) {
    rows = rows.filter(
      (r) => r.recommendation_date !== null && r.recommendation_date <= dateTo,
    );
  }

  const editedFrom = params.editedFrom;
  if (editedFrom) {
    rows = rows.filter(
      (row) => (row.updated_at ?? row.created_at).slice(0, 10) >= editedFrom,
    );
  }
  const editedTo = params.editedTo;
  if (editedTo) {
    rows = rows.filter(
      (row) => (row.updated_at ?? row.created_at).slice(0, 10) <= editedTo,
    );
  }

  const orderBy = params.orderBy ?? "created_at";
  const orderDir = params.orderDir ?? "desc";
  rows = [...rows].sort((a, b) => {
    const row = a as unknown as Record<string, unknown>;
    const other = b as unknown as Record<string, unknown>;
    const cmp = String(row[orderBy] ?? "").localeCompare(
      String(other[orderBy] ?? ""),
    );
    return orderDir === "asc" ? cmp : -cmp;
  });

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const items = rows.slice(start, start + pageSize);
  return delay({ items, total, page, page_size: pageSize });
}

export function mockRecommendationEnums(): Promise<RecommendationEnums> {
  return delay({
    situations: [...RECOMMENDATION_SITUATIONS],
    statuses: [...RECOMMENDATION_STATUSES],
  });
}

export function mockPatchRecommendationSeguimiento(input: {
  recommendationId: string;
  payload: Partial<{
    file_number: string | null;
    recommendation_detail: string | null;
    recommendation_situation: string | null;
    status: string | null;
    approved_for_publication: boolean | null;
    link: string | null;
  }>;
}): Promise<RecommendationRow> {
  const existing = recommendationRows.get(input.recommendationId);
  if (!existing) {
    throw new Error(`Recommendation not found: ${input.recommendationId}`);
  }
  // Object spread only copies keys `payload` actually has, same
  // absent-vs-null semantics as the real PATCH -- an omitted field here
  // leaves `existing`'s value untouched, exactly as `exclude_unset` does
  // server-side. `existing` carries `source_text`/`prediction` too (the map
  // now stores the full detail, per mockRecommendationDetail below), so this
  // preserves them even though the PATCH response itself only needs the row.
  const updated: RecommendationDetail = {
    ...existing,
    ...input.payload,
    updated_at: now,
  };
  recommendationRows.set(input.recommendationId, updated);
  return delay(updated);
}

/**
 * Single-recommendation detail (source text + raw prediction) for the
 * correction screen -- mirrors `GET /llm/data-extraction/recommendations/{id}`.
 */
export function mockRecommendationDetail(
  recommendationId: string,
): Promise<RecommendationDetail> {
  const existing = recommendationRows.get(recommendationId);
  if (!existing) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }
  return delay(existing);
}

/**
 * Saves a correction, simulating the real endpoint's `If-Match` optimistic
 * concurrency check (mirrors `_etag` in
 * `tests/api/routers/llm/data_extraction/test_recommendation_correction.py`:
 * `updated_at` when set, else `created_at`). A mismatch rejects with an
 * `AxiosError` shaped like the real 412 response
 * (`error.response?.status === 412`), the same check the real branch's PUT
 * would surface, so the Task 3 conflict UI has something to exercise here too.
 */
export function mockCorrectRecommendation(input: {
  recommendationId: string;
  ifMatch: string;
  payload: RecommendationValidationInput;
}): Promise<RecommendationDetail> {
  const existing = recommendationRows.get(input.recommendationId);
  if (!existing) {
    throw new Error(`Recommendation not found: ${input.recommendationId}`);
  }

  const currentEtag = existing.updated_at ?? existing.created_at;
  if (input.ifMatch !== currentEtag) {
    return Promise.reject(
      new AxiosError(
        "Precondition Failed: the recommendation was modified since it was last read.",
        "ERR_BAD_REQUEST",
        undefined,
        undefined,
        {
          status: 412,
          statusText: "Precondition Failed",
          data: { detail: "Precondition Failed" },
          headers: {},
          config: {},
        } as never,
      ),
    );
  }

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

  const updated: RecommendationDetail = {
    ...existing,
    recommendation_number: input.payload.recommendation_number,
    recommendation_date_text: input.payload.recommendation_date_text,
    // Same re-derive-unless-overridden rule as mockValidateRecommendation.
    recommendation_date:
      input.payload.recommendation_date ??
      parseSpanishProseDate(input.payload.recommendation_date_text),
    topic: input.payload.topic,
    subtopic: input.payload.subtopic,
    personal_data: input.payload.personal_data,
    publishable_content: input.payload.publishable_content,
    recipients,
    updated_at: now,
  };
  recommendationRows.set(input.recommendationId, updated);
  return delay(updated);
}

/**
 * Minimal placeholder file — enough for the download flow to exercise a real
 * `Blob` end to end without depending on a real xlsx/csv writer in the mock.
 */
function mockTimestamp(): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const d = new Date();
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function mockDownloadRecommendationsExport(
  format: "xlsx" | "csv",
): Promise<RecommendationsExportResult> {
  const type =
    format === "csv"
      ? "text/csv"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const placeholder =
    format === "csv"
      ? "recommendation_number,topic,subtopic\n123/2026,Salud,Acceso a medicamentos\n"
      : "mock xlsx placeholder";
  const blob = new Blob([placeholder], { type });
  const fileName = `recomendaciones_${mockTimestamp()}.${format}`;
  return delay({ blob, fileName });
}
