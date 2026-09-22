import { Button, Checkbox, Search } from "@aymurai/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { css } from "@/styled/css";
import { HStack, Stack } from "@/styled/jsx";

/**
 * The grilla's filter bar. Purely presentational: it owns no query, only the
 * values `RecommendationsGrid` feeds straight into `recommendationsList(...)`.
 *
 * `topic_id`/`sector_id` are supported by the endpoint but not offered here —
 * both need a catalog picker, and neither is part of what the Excel sheet this
 * screen replaces let anybody filter by.
 */

const bar = css({
  flexWrap: "wrap",
  alignItems: "flex-end",
  gap: "4",
  width: "full",
});

const searchSlot = css({ flex: "1", minW: "[240px]" });

const dateLabel = css({
  textStyle: "label.sm.default",
  color: "text.lighter",
});

const dateInput = css({
  textStyle: "label.md.default",
  color: "text.default",
  bg: "bg.secondary",
  border: "primary",
  rounded: "sm",
  px: "3",
  h: "10",
  "&:focus-visible": {
    outline: "none",
    border: "primary-alt",
    boxShadow: "input-focus",
  },
});

export interface RecommendationsGridFilterValues {
  /** Raw text of the search box — debounced into `q` by the grid. */
  search: string;
  /** `YYYY-MM-DD`, or `""` for "no bound". */
  dateFrom: string;
  dateTo: string;
  /** Only the rows whose `recommendation_date` never parsed. */
  unparsedDates: boolean;
}

interface RecommendationsGridFiltersProps {
  values: RecommendationsGridFilterValues;
  onChange: (patch: Partial<RecommendationsGridFilterValues>) => void;
  onReset: () => void;
  /** Whether anything is actually filtering — gates the reset button. */
  isFiltered: boolean;
}

export default function RecommendationsGridFilters({
  values,
  onChange,
  onReset,
  isFiltered,
}: RecommendationsGridFiltersProps) {
  const { t } = useTranslation("recommendations");
  const fromId = useId();
  const toId = useId();

  return (
    <HStack className={bar}>
      <div className={searchSlot}>
        <Search
          aria-label={t("grid.filters.searchLabel")}
          placeholder={t("grid.filters.searchPlaceholder")}
          value={values.search}
          onChange={(event) => onChange({ search: event.target.value })}
          onClear={() => onChange({ search: "" })}
          labels={{ clear: t("grid.filters.clearSearch") }}
        />
      </div>

      <Stack gap="1">
        <label className={dateLabel} htmlFor={fromId}>
          {t("grid.filters.dateFrom")}
        </label>
        <input
          id={fromId}
          type="date"
          className={dateInput}
          value={values.dateFrom}
          onChange={(event) => onChange({ dateFrom: event.target.value })}
        />
      </Stack>

      <Stack gap="1">
        <label className={dateLabel} htmlFor={toId}>
          {t("grid.filters.dateTo")}
        </label>
        <input
          id={toId}
          type="date"
          className={dateInput}
          value={values.dateTo}
          onChange={(event) => onChange({ dateTo: event.target.value })}
        />
      </Stack>

      <Checkbox
        checked={values.unparsedDates}
        onChange={(checked) => onChange({ unparsedDates: checked })}
      >
        {t("grid.filters.unparsedDates")}
      </Checkbox>

      <Button
        variant="tertiary"
        size="sm"
        onClick={onReset}
        disabled={!isFiltered}
      >
        {t("grid.filters.reset")}
      </Button>
    </HStack>
  );
}
