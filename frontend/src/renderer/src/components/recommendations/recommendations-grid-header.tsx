import { CaretDown, CaretUp } from "phosphor-react";
import { useTranslation } from "react-i18next";
import { css, cx } from "@/styled/css";
import { COLUMNS, type SortColumn } from "./recommendations-grid-columns";
import {
  stickyFirstHeadCell,
  tableHeadCell,
} from "./recommendations-table-header-styles";

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

export default function RecommendationsGridHeader({
  orderBy,
  orderDir,
  onSort,
}: {
  orderBy: SortColumn;
  orderDir: "asc" | "desc";
  onSort: (column: SortColumn) => void;
}) {
  const { t } = useTranslation("recommendations");
  return (
    <thead>
      <tr>
        {COLUMNS.map((column) => {
          const active = column.sortBy === orderBy;
          return (
            <th
              key={column.id}
              scope="col"
              className={cx(
                tableHeadCell,
                column.id === "recommendationNumber" && stickyFirstHeadCell,
              )}
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
                  onClick={() => column.sortBy && onSort(column.sortBy)}
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
  );
}
