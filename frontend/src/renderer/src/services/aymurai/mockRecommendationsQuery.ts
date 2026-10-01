import type { RecommendationRow } from "@/types/dataExtraction";
import { normalizeForSearch } from "@/utils/organigram/normalize-for-search";
import {
  mockListMacroSectors,
  mockListSubtopics,
  mockListTopics,
} from "./mockCatalogs";

/**
 * The filters and sort `GET /llm/data-extraction/recommendations` takes,
 * pagination aside (`mockRecommendationsList` slices the result).
 */
export interface MockRecommendationsQuery {
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
}

/**
 * Filters and sorts the mock store's rows the way the real listing does
 * (`database/crud/recommendation_listing.py`), so the grilla behaves the same
 * against the mock as against the backend.
 */
export async function queryMockRecommendations<T extends RecommendationRow>(
  allRows: T[],
  params: MockRecommendationsQuery,
): Promise<T[]> {
  let rows = allRows;

  if (params.unparsedDates) {
    // Both halves, exactly as the real filter does it: prose the model read
    // but could not parse. A row with no date text at all was never a date
    // to interpret, so it is not one a human has to correct.
    rows = rows.filter(
      (r) =>
        r.recommendation_date_text !== null && r.recommendation_date === null,
    );
  }
  // Folded like the real endpoint does it (`normalize_text` on both sides),
  // so "area" finds "Área" here too.
  const q = normalizeForSearch(params.q);
  if (q) {
    // The same fields the real endpoint matches (`recommendation_listing.py`):
    // the row's own text columns, its tema/subtema names, and every
    // recipient's name, cargo, unidad, sector and ámbito.
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
      ].some((field) => field != null && normalizeForSearch(field).includes(q)),
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
  // `last_edited` is not a field of the row: the real endpoint computes it
  // as `COALESCE(updated_at, created_at)`.
  const sortValue = (r: T): unknown =>
    orderBy === "last_edited"
      ? (r.updated_at ?? r.created_at)
      : (r as unknown as Record<string, unknown>)[orderBy];
  rows = [...rows].sort((a, b) => {
    const cmp = String(sortValue(a) ?? "").localeCompare(
      String(sortValue(b) ?? ""),
    );
    return orderDir === "asc" ? cmp : -cmp;
  });

  return rows;
}
