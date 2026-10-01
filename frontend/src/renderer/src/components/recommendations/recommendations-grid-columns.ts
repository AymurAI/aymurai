/**
 * The grilla's column list, shared by the header (`recommendations-grid.tsx`)
 * and the body (`recommendations-grid-row.tsx`) so the two cannot drift: the
 * row renders its `<td>`s in exactly this order, and both sides build their
 * labels from the same ids.
 */

/** Key under `grilla.columns` in the `recommendations` i18n namespace. */
export type ColumnId =
  | "recommendationNumber"
  | "recommendationDate"
  | "topic"
  | "subtopic"
  | "recipient"
  | "publishableContent"
  | "personalData"
  | "fileNumber"
  | "recommendationDetail"
  | "recommendationSituation"
  | "status"
  | "approvedForPublication"
  | "link"
  | "lastEdited"
  | "edit";

/**
 * The columns the backend will order by — whitelisted there (issue #58) to
 * the ones that need no join, so this list is not free to grow on its own.
 */
export type SortColumn =
  | "created_at"
  | "recommendation_date"
  | "recommendation_number"
  | "status"
  | "recommendation_situation"
  | "file_number"
  | "last_edited";

export interface ColumnSpec {
  id: ColumnId;
  /** Absent on the columns the server cannot order by. */
  sortBy?: SortColumn;
}

/**
 * "Última edición" shows `updated_at ?? created_at` and sorts by
 * `last_edited`, the server's `COALESCE(updated_at, created_at)` -- the same
 * value, so the order on screen matches the dates on screen.
 */
export const COLUMNS: ColumnSpec[] = [
  { id: "recommendationNumber", sortBy: "recommendation_number" },
  { id: "recommendationDate", sortBy: "recommendation_date" },
  { id: "topic" },
  { id: "subtopic" },
  { id: "recipient" },
  // Read-only: both come from the document (validated, not tracked), so the
  // grilla shows them -- the workbook has them -- but only correcting the
  // recommendation can change them.
  { id: "publishableContent" },
  { id: "personalData" },
  { id: "fileNumber", sortBy: "file_number" },
  { id: "recommendationDetail" },
  { id: "recommendationSituation", sortBy: "recommendation_situation" },
  { id: "status", sortBy: "status" },
  { id: "approvedForPublication" },
  { id: "link" },
  { id: "lastEdited", sortBy: "last_edited" },
  { id: "edit" },
];
