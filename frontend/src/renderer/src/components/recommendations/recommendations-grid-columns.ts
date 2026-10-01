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
  | "file_number";

export interface ColumnSpec {
  id: ColumnId;
  /** Absent on the columns the server cannot order by. */
  sortBy?: SortColumn;
}

/**
 * "Última edición" shows `updated_at ?? created_at` but sorts by `created_at`:
 * that is the only one of the two in the server's order whitelist, and on a
 * never-edited row (the majority, until the base is worked through) they are
 * the same instant anyway.
 */
export const COLUMNS: ColumnSpec[] = [
  { id: "recommendationNumber", sortBy: "recommendation_number" },
  { id: "recommendationDate", sortBy: "recommendation_date" },
  { id: "topic" },
  { id: "subtopic" },
  { id: "recipient" },
  { id: "publishableContent" },
  { id: "fileNumber", sortBy: "file_number" },
  { id: "recommendationDetail" },
  { id: "recommendationSituation", sortBy: "recommendation_situation" },
  { id: "status", sortBy: "status" },
  { id: "approvedForPublication" },
  { id: "link" },
  { id: "lastEdited", sortBy: "created_at" },
  { id: "edit" },
];
