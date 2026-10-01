import { z } from "zod";
import { COLUMNS, type SortColumn } from "./recommendations-grid-columns";
import type { RecommendationsGridFilterValues } from "./recommendations-grid-filters";
import type { RecommendationsGridView } from "./recommendations-grid-toolbar";

/**
 * The grilla's filters, sort, page and tab, as they live in the URL of
 * `/home/dataset` (and ride along to `/home/dataset/$recommendationId`, so the
 * correction screen can send the person back to exactly the view they left).
 *
 * In the URL rather than in component state because the correction screen is
 * a separate route: state would die with the grilla on the way there, and a
 * bare `navigate({ to: "/home/dataset" })` on the way back would land on page
 * 1, unfiltered — the person loses their place after every correction.
 *
 * Every key is optional and a default is never written: a fresh grilla has a
 * bare URL, and only what the person actually changed shows up in it.
 */
export interface RecommendationsGridSearch {
  q?: string;
  topicId?: string;
  subtopicId?: string;
  recipientSector?: string;
  situation?: string;
  status?: string;
  publication?: "yes" | "no" | "unanswered";
  dateFrom?: string;
  dateTo?: string;
  editedFrom?: string;
  editedTo?: string;
  page?: number;
  orderBy?: SortColumn;
  orderDir?: "asc" | "desc";
  view?: RecommendationsGridView;
}

// "Última edición", newest first: the header marks that column as the active
// sort, so the first request has to actually order by it.
export const DEFAULT_ORDER_BY: SortColumn = "last_edited";
export const DEFAULT_ORDER_DIR = "desc";
export const DEFAULT_VIEW: RecommendationsGridView = "seguimiento";

// Read off the column list rather than restated, so a column that becomes
// sortable there is accepted from the URL without touching this file.
const SORTABLE = new Set<string>(
  COLUMNS.flatMap((column) => (column.sortBy ? [column.sortBy] : [])),
);

// TanStack's default search parser JSON-decodes each value, so a search for
// `123` arrives as a number. Anything malformed is dropped rather than thrown:
// a stale or hand-edited link should open the grilla, not an error screen.
const text = z
  .preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string().min(1).optional(),
  )
  .catch(undefined);

const gridSearchSchema = z.object({
  q: text,
  topicId: text,
  subtopicId: text,
  recipientSector: text,
  situation: text,
  status: text,
  publication: z.enum(["yes", "no", "unanswered"]).optional().catch(undefined),
  dateFrom: text,
  dateTo: text,
  editedFrom: text,
  editedTo: text,
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  orderBy: z
    .custom<SortColumn>(
      (value) => typeof value === "string" && SORTABLE.has(value),
    )
    .optional()
    .catch(undefined),
  orderDir: z.enum(["asc", "desc"]).optional().catch(undefined),
  view: z.enum(["seguimiento", "recipients"]).optional().catch(undefined),
});

/**
 * Drops every key that is empty or equal to its default, so what reaches the
 * URL is only what the person changed.
 */
export function compactGridSearch(
  search: RecommendationsGridSearch,
): RecommendationsGridSearch {
  const defaults: RecommendationsGridSearch = {
    page: 1,
    orderBy: DEFAULT_ORDER_BY,
    orderDir: DEFAULT_ORDER_DIR,
    view: DEFAULT_VIEW,
  };
  return Object.fromEntries(
    Object.entries(search).filter(
      ([key, value]) =>
        value !== undefined &&
        value !== "" &&
        value !== defaults[key as keyof RecommendationsGridSearch],
    ),
  );
}

/** `validateSearch` for both `/home/dataset` and its correction child. */
export function validateGridSearch(
  raw: Record<string, unknown>,
): RecommendationsGridSearch {
  return compactGridSearch(gridSearchSchema.parse(raw));
}

/** The filter panel's values (minus the live search box) for a URL search. */
export function filtersFromSearch(
  search: RecommendationsGridSearch,
): Omit<RecommendationsGridFilterValues, "search"> {
  return {
    topicId: search.topicId ?? "",
    subtopicId: search.subtopicId ?? "",
    recipientSector: search.recipientSector ?? "",
    situation: search.situation ?? "",
    status: search.status ?? "",
    publication: search.publication ?? "all",
    dateFrom: search.dateFrom ?? "",
    dateTo: search.dateTo ?? "",
    editedFrom: search.editedFrom ?? "",
    editedTo: search.editedTo ?? "",
  };
}

/** The URL search for a set of filter panel values (the search box aside). */
export function searchFromFilters(
  filters: Partial<Omit<RecommendationsGridFilterValues, "search">>,
): RecommendationsGridSearch {
  const { publication, ...rest } = filters;
  return {
    ...rest,
    ...(publication === undefined
      ? {}
      : { publication: publication === "all" ? undefined : publication }),
  };
}
