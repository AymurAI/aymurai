import { Button, Search } from "@aymurai/ui";
import { Funnel } from "phosphor-react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { HStack, Stack } from "@/styled/jsx";
import RecommendationsGridTabs from "./recommendations-grid-tabs";

export type RecommendationsGridView = "seguimiento" | "recipients";

interface RecommendationsGridToolbarProps {
  tabsId: string;
  view: RecommendationsGridView;
  setView: Dispatch<SetStateAction<RecommendationsGridView>>;
  filtersOpen: boolean;
  search: string;
  exportPending: boolean;
  onToggleFilters: () => void;
  onSearch: (search: string) => void;
  onExport: () => void;
}

export default function RecommendationsGridToolbar({
  tabsId,
  view,
  setView,
  filtersOpen,
  search,
  exportPending,
  onToggleFilters,
  onSearch,
  onExport,
}: RecommendationsGridToolbarProps) {
  const { t } = useTranslation("recommendations");
  return (
    <Stack gap="4">
      <HStack justify="space-between" flexWrap="wrap" gap="3">
        <RecommendationsGridTabs
          tabsId={tabsId}
          view={view}
          setView={setView}
        />
        <HStack gap="3">
          <Button
            variant="secondary"
            aria-label={t("grilla.filters.open")}
            aria-expanded={filtersOpen}
            onClick={onToggleFilters}
          >
            <Funnel size={18} aria-hidden="true" />
            {t("grilla.filters.button")}
          </Button>
          <Button onClick={onExport} disabled={exportPending}>
            {t(
              exportPending
                ? "grilla.export.pending"
                : "grilla.export.download",
            )}
          </Button>
        </HStack>
      </HStack>
      <Search
        aria-label={t("grilla.filters.searchLabel")}
        placeholder={t("grilla.filters.searchPlaceholder")}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        onClear={() => onSearch("")}
        labels={{ clear: t("grilla.filters.clearSearch") }}
      />
    </Stack>
  );
}
