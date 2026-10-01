import { Callout, PageTitle, Spinner } from "@aymurai/ui";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { listMacroSectors } from "@/services/aymurai/catalogs";
import {
  patchRecommendationSeguimiento,
  recommendationEnums,
  recommendationsList,
} from "@/services/aymurai/dataExtraction";
import { useExportRecommendations } from "@/services/export/use-export-recommendations";
import { css } from "@/styled/css";
import { HStack, Stack, styled } from "@/styled/jsx";
import type { SortColumn } from "./recommendations-grid-columns";
import RecommendationsGridFilters, {
  type RecommendationsGridFilterValues,
} from "./recommendations-grid-filters";
import RecommendationsGridHeader from "./recommendations-grid-header";
import RecommendationsGridPagination from "./recommendations-grid-pagination";
import RecommendationsGridRecipients from "./recommendations-grid-recipients";
import RecommendationsGridRow, {
  type RecommendationSeguimientoPatch,
  type SeguimientoField,
} from "./recommendations-grid-row";
import RecommendationsGridToolbar, {
  type RecommendationsGridView,
} from "./recommendations-grid-toolbar";

/** Server-paginated tracking grid with per-field inline edits. */

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
  topicId: "",
  subtopicId: "",
  recipientSector: "",
  situation: "",
  status: "",
  publication: "all",
  dateFrom: "",
  dateTo: "",
  editedFrom: "",
  editedTo: "",
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
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
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

const message = css({
  textStyle: "paragraph.md.default",
  color: "text.lighter",
  py: "8",
});

export default function RecommendationsGrid() {
  const { t } = useTranslation("recommendations");
  const queryClient = useQueryClient();
  const tabsId = useId();
  const [view, setView] = useState<RecommendationsGridView>("seguimiento");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const macroSectors = useQuery(listMacroSectors());
  const exporter = useExportRecommendations();

  const [filters, setFilters] =
    useState<RecommendationsGridFilterValues>(EMPTY_FILTERS);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [orderBy, setOrderBy] = useState<SortColumn>("created_at");
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

  useEffect(() => {
    if (!filtersOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [filtersOpen]);

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
      topicId: filters.topicId || undefined,
      subtopicId: filters.subtopicId || undefined,
      sectorId: filters.recipientSector.startsWith("sector:")
        ? filters.recipientSector.slice(7)
        : undefined,
      macroSectorId: filters.recipientSector.startsWith("macro:")
        ? filters.recipientSector.slice(6)
        : undefined,
      recommendationSituation: filters.situation || undefined,
      status: filters.status || undefined,
      approvedForPublication:
        filters.publication === "yes"
          ? true
          : filters.publication === "no"
            ? false
            : undefined,
      publicationUnanswered: filters.publication === "unanswered" || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      editedFrom: filters.editedFrom || undefined,
      editedTo: filters.editedTo || undefined,
    }),
    // Paging, sorting and filtering each land on a different cache key, so
    // without this the table is replaced by the spinner on every one of them
    // — and the row somebody was mid-edit disappears under them. Keeping the
    // previous page on screen until the new one arrives is what makes this
    // feel like a spreadsheet rather than a series of page loads.
    placeholderData: keepPreviousData,
  });

  // A saved edit can remove the final match on this page. Wait for the new
  // result rather than clamping against the previous page's placeholder data.
  useEffect(() => {
    if (!list.data || list.isPlaceholderData) return;
    const lastPage = Math.max(1, Math.ceil(list.data.total / PAGE_SIZE));
    if (page > lastPage) setPage(lastPage);
  }, [list.data, list.isPlaceholderData, page]);

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
    filters.topicId !== "" ||
    filters.subtopicId !== "" ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    filters.editedFrom !== "" ||
    filters.editedTo !== "" ||
    filters.recipientSector !== "" ||
    filters.situation !== "" ||
    filters.status !== "" ||
    filters.publication !== "all";

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

  return (
    <Stack gap="6" width="full" flex="1" minH="0">
      <Stack gap="1">
        <PageTitle>{t("grilla.title")}</PageTitle>
        <styled.p className={subtitle}>{t("grilla.subtitle")}</styled.p>
      </Stack>

      <RecommendationsGridToolbar
        tabsId={tabsId}
        view={view}
        setView={setView}
        filtersOpen={filtersOpen}
        search={filters.search}
        exportPending={exporter.isPending}
        onToggleFilters={() => setFiltersOpen((open) => !open)}
        onSearch={(search) => updateFilters({ search })}
        onExport={() => exporter.download()}
      />
      {exporter.isError && (
        <Callout
          variant="error"
          role="alert"
          message={t("grilla.export.failed")}
        />
      )}

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

      <div
        className={css({
          position: "relative",
          display: "flex",
          flex: "1",
          minH: "0",
          overflow: "hidden",
        })}
      >
        <div
          role="tabpanel"
          id={`${tabsId}-panel`}
          aria-labelledby={`${tabsId}-${view}`}
          className={css({
            display: "flex",
            flexDirection: "column",
            flex: "1",
            minH: "0",
            minW: "0",
          })}
        >
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
              <div className={css({ overflow: "auto", minH: "0", flex: "1" })}>
                {view === "recipients" ? (
                  <RecommendationsGridRecipients
                    rows={rows}
                    catalogs={macroSectors.data ?? []}
                  />
                ) : (
                  <table className={table}>
                    <RecommendationsGridHeader
                      orderBy={orderBy}
                      orderDir={orderDir}
                      onSort={toggleSort}
                    />
                    <tbody>
                      {rows.map((row) => (
                        <RecommendationsGridRow
                          key={row.id}
                          row={row}
                          macroSectors={macroSectors.data ?? []}
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
                )}
              </div>
            </div>
          )}
        </div>
        {filtersOpen && (
          <RecommendationsGridFilters
            values={filters}
            situations={enums.data?.situations ?? []}
            statuses={enums.data?.statuses ?? []}
            catalogsReady={enums.data !== undefined}
            onChange={updateFilters}
            onClose={() => setFiltersOpen(false)}
            onReset={() => {
              setFilters(EMPTY_FILTERS);
              setQ("");
              setPage(1);
            }}
            isFiltered={isFiltered}
          />
        )}
      </div>

      <RecommendationsGridPagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPage={setPage}
      />
    </Stack>
  );
}
