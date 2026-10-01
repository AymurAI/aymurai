import { Button, Callout, PageTitle, Spinner } from "@aymurai/ui";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CaretDown, CaretLeft, CaretRight, CaretUp } from "phosphor-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  patchRecommendationSeguimiento,
  recommendationEnums,
  recommendationsList,
} from "@/services/aymurai/dataExtraction";
import { css } from "@/styled/css";
import { HStack, Stack, styled } from "@/styled/jsx";
import { COLUMNS, type SortColumn } from "./recommendations-grid-columns";
import RecommendationsGridFilters, {
  type RecommendationsGridFilterValues,
} from "./recommendations-grid-filters";
import RecommendationsGridRow, {
  type RecommendationSeguimientoPatch,
  type SeguimientoField,
} from "./recommendations-grid-row";

/**
 * The grilla de seguimiento: every recomendación in the shared dataset, with
 * the six post-publication fields editable in place. This is what replaces
 * the external spreadsheet three to five people edit by hand (issue #58).
 *
 * The server paginates, filters and orders — there is no client-side table
 * engine here on purpose: with the page already coming back sorted and cut,
 * `@tanstack/react-table` would only add weight. One edit is one PATCH of one
 * key, so a save never has to rebuild the row.
 */

const PAGE_SIZE = 20;

/** Long enough that typing a number doesn't fire a request per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Identifies one cell across the whole grid. Every `onEdit` sends exactly one
 * key (one commit, one field), so the joined key names the cell that failed --
 * which is what lets an unrelated row's success stop clearing this row's
 * warning.
 */
function editKey(
  recommendationId: string,
  payload: RecommendationSeguimientoPatch,
) {
  return `${recommendationId}:${Object.keys(payload).join(",")}`;
}

const EMPTY_FILTERS: RecommendationsGridFilterValues = {
  search: "",
  dateFrom: "",
  dateTo: "",
  unparsedDates: false,
};

const subtitle = css({
  textStyle: "paragraph.sm.default",
  color: "text.lighter",
});

// The table is wider than any window, so the scroll belongs to this box (the
// screen itself must not scroll sideways) and the header row sticks to its top.
const tableWrap = css({
  flex: "1",
  minH: "0",
  overflow: "auto",
  bg: "bg.secondary",
  border: "card",
  borderRadius: "lg",
});

const table = css({
  width: "full",
  borderCollapse: "separate",
  borderSpacing: "0",
  textAlign: "left",
});

const headCell = css({
  position: "sticky",
  top: "0",
  zIndex: "[1]",
  bg: "bg.primary",
  px: "3",
  py: "2",
  whiteSpace: "nowrap",
  textStyle: "label.sm.strong",
  color: "text.lighter",
  borderBottomWidth: "1",
  borderBottomStyle: "solid",
  borderBottomColor: "bg.secondary-highlight",
});

const sortButton = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "1",
  p: "0",
  borderWidth: "0",
  bg: "[transparent]",
  font: "inherit",
  color: "[inherit]",
  cursor: "pointer",
  "&:hover": { color: "text.default" },
});

const message = css({
  textStyle: "paragraph.md.default",
  color: "text.lighter",
  py: "8",
});

export default function RecommendationsGrid() {
  const { t } = useTranslation("recommendations");
  const queryClient = useQueryClient();

  const [filters, setFilters] =
    useState<RecommendationsGridFilterValues>(EMPTY_FILTERS);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  // "Última edición", newest first: the header marks that column as the
  // active sort, so the first request has to actually order by it.
  const [orderBy, setOrderBy] = useState<SortColumn>("last_edited");
  const [orderDir, setOrderDir] = useState<"asc" | "desc">("desc");
  // Per cell, not one flag for the screen: a save that failed on row A stays
  // reported until *that* edit succeeds, however many other rows are saved in
  // the meantime. `EditableTextCell` keeps showing the text it never managed
  // to save, so a flag cleared by an unrelated success would leave a value on
  // screen the server does not have.
  const [failedEdits, setFailedEdits] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Debounced rather than committed on Enter: the search is a narrowing
  // gesture people watch while typing, and the endpoint answers a substring
  // match over the four text columns that need no join (número, expediente,
  // detalle, contenido -- `_SEARCH_COLUMNS` server-side).
  useEffect(() => {
    const timer = setTimeout(() => setQ(filters.search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters.search]);

  // Any narrowing invalidates the page number: page 3 of the old result set is
  // very likely past the end of the new one. Reset here, where the change
  // actually happens, rather than in an effect watching the filters.
  const updateFilters = (patch: Partial<RecommendationsGridFilterValues>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const list = useQuery({
    ...recommendationsList({
      page,
      pageSize: PAGE_SIZE,
      orderBy,
      orderDir,
      q: q || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      unparsedDates: filters.unparsedDates || undefined,
    }),
    // Paging, sorting and filtering each land on a different cache key, so
    // without this the table is replaced by the spinner on every one of them
    // — and the row somebody was mid-edit disappears under them. Keeping the
    // previous page on screen until the new one arrives is what makes this
    // feel like a spreadsheet rather than a series of page loads.
    placeholderData: keepPreviousData,
  });

  // The two closed catalogs behind `status`/`recommendation_situation`. Never
  // written out in TS: they are the server's to change (issue #58).
  const enums = useQuery(recommendationEnums());

  const save = useMutation({
    ...patchRecommendationSeguimiento(),
    onSuccess: (_row, variables) => {
      const key = editKey(variables.recommendationId, variables.payload);
      setFailedEdits((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      // Every page/filter combination is its own cache entry (the factory
      // keys on the whole params object), so an edit has to invalidate the
      // prefix rather than the one key currently on screen. Read off the
      // factory instead of hardcoded, the same reflex as `topics-panel.tsx`.
      queryClient.invalidateQueries({
        queryKey: [recommendationsList({}).queryKey[0]],
      });
    },
    onError: (_error, variables) => {
      const key = editKey(variables.recommendationId, variables.payload);
      setFailedEdits((current) => new Set(current).add(key));
    },
  });

  const isFiltered =
    q !== "" ||
    filters.search !== "" ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    filters.unparsedDates;

  const toggleSort = (column: SortColumn) => {
    setPage(1);
    if (column === orderBy) {
      setOrderDir((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setOrderBy(column);
    setOrderDir("asc");
  };

  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const firstOnPage = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = Math.min(page * PAGE_SIZE, total);

  return (
    <Stack gap="6" width="full" flex="1" minH="0">
      <Stack gap="1">
        <PageTitle>{t("grilla.title")}</PageTitle>
        <styled.p className={subtitle}>{t("grilla.subtitle")}</styled.p>
      </Stack>

      <RecommendationsGridFilters
        values={filters}
        onChange={updateFilters}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}
        isFiltered={isFiltered}
      />

      {/* Not dismissible: it stands for edits the server does not have, and
          it disappears the moment a retry lands. The offending cells carry
          their own inline mark. */}
      {failedEdits.size > 0 && (
        <Callout
          variant="error"
          role="alert"
          message={t("grilla.saveFailed")}
        />
      )}

      {/* Without this the two catalog dropdowns would be indistinguishable
          from empty catalogs -- and clearing one would erase a value with
          nothing left to restore it from. The cells lock while it shows. */}
      {enums.isError && (
        <Callout
          variant="error"
          role="alert"
          message={t("grilla.enumsFailed")}
        />
      )}

      {list.isError ? (
        <Callout
          variant="error"
          role="alert"
          message={t("grilla.loadFailed")}
        />
      ) : list.isPending ? (
        <HStack justify="center" py="8">
          <Spinner />
        </HStack>
      ) : rows.length === 0 ? (
        <styled.p className={message}>
          {isFiltered ? t("grilla.emptyFiltered") : t("grilla.empty")}
        </styled.p>
      ) : (
        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const active = column.sortBy === orderBy;
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      className={headCell}
                      aria-sort={
                        active
                          ? orderDir === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                    >
                      {column.sortBy ? (
                        <button
                          type="button"
                          className={sortButton}
                          onClick={() =>
                            column.sortBy && toggleSort(column.sortBy)
                          }
                        >
                          {t(`grilla.columns.${column.id}`)}
                          {active &&
                            (orderDir === "asc" ? (
                              <CaretUp size={12} aria-hidden="true" />
                            ) : (
                              <CaretDown size={12} aria-hidden="true" />
                            ))}
                        </button>
                      ) : (
                        t(`grilla.columns.${column.id}`)
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <RecommendationsGridRow
                  key={row.id}
                  row={row}
                  situations={enums.data?.situations ?? []}
                  statuses={enums.data?.statuses ?? []}
                  catalogsReady={enums.data !== undefined}
                  hasFailed={(field: SeguimientoField) =>
                    failedEdits.has(`${row.id}:${field}`)
                  }
                  saveFailedMessage={t("grilla.cellSaveFailed")}
                  onEdit={(payload) =>
                    save.mutate({ recommendationId: row.id, payload })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <HStack justify="flex-end" alignItems="center" gap="3">
          <styled.span className={subtitle}>
            {t("grilla.pagination.range", {
              from: firstOnPage,
              to: lastOnPage,
              total,
            })}
          </styled.span>
          <Button
            variant="tertiary"
            size="sm"
            aria-label={t("grilla.pagination.previous")}
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <CaretLeft size={16} aria-hidden="true" />
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            aria-label={t("grilla.pagination.next")}
            disabled={lastOnPage >= total}
            onClick={() => setPage((current) => current + 1)}
          >
            <CaretRight size={16} aria-hidden="true" />
          </Button>
        </HStack>
      )}
    </Stack>
  );
}
