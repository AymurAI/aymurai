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
// a stale or hand-edited link should open the grilla, not an error screen --
// and a value the server would reject (a non-uuid id, a non-ISO date) must not
// reach the list request, where it would turn into a 422 instead.
const asText = (value: unknown) =>
  typeof value === "number" ? String(value) : value;
const text = z
  .preprocess(asText, z.string().min(1).optional())
  .catch(undefined);
const uuid = z.uuid().optional().catch(undefined);
// `YYYY-MM-DD`, a real calendar day -- what the date inputs emit and what the
// endpoint parses.
const isoDate = z.iso.date().optional().catch(undefined);
// `sector:<uuid>` or `macro:<uuid>`: the filter panel's single picker encodes
// which of the two server filters the id belongs to.
const recipientSector = z
  .string()
  .regex(
    /^(sector|macro):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  )
  .optional()
  .catch(undefined);

const gridSearchSchema = z.object({
  q: text,
  topicId: uuid,
  subtopicId: uuid,
  recipientSector,
  // Situación and estado are closed catalogs, but they belong to the server
  // (`GET /catalogs/recommendation-enums`) and are never written out in TS
  // (ADR-0015), so the URL can only insist on a non-empty string; a value
  // outside the catalog matches nothing in the filter's dropdown.
  situation: text,
  status: text,
  publication: z.enum(["yes", "no", "unanswered"]).optional().catch(undefined),
  dateFrom: isoDate,
  dateTo: isoDate,
  editedFrom: isoDate,
  editedTo: isoDate,
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
  const compact = compactGridSearch(gridSearchSchema.parse(raw));
  // Every known key comes back, `undefined` when dropped -- not left out.
  // TanStack merges a route's validated search over the raw location search,
  // so a key that is merely absent here lets the raw (malformed) value through
  // to `useSearch()`; an explicit `undefined` overrides it.
  return Object.fromEntries(
    Object.keys(gridSearchSchema.shape).map((key) => [
      key,
      compact[key as keyof RecommendationsGridSearch],
    ]),
  );
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
