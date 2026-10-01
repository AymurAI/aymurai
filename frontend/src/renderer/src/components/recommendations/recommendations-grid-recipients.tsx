import { useTranslation } from "react-i18next";
import { css, cx } from "@/styled/css";
import type { MacroSector } from "@/types/catalogs";
import type { RecommendationRow } from "@/types/dataExtraction";
import { primaryRecipient, recipientSector } from "./recipient-display";
import RecommendationEditLink from "./recommendation-edit-link";
import type { RecommendationsGridSearch } from "./recommendations-grid-search";
import {
  stickyFirstHeadCell,
  tableHeadCell,
} from "./recommendations-table-header-styles";

const cell = css({
  px: "3",
  py: "3",
  textAlign: "left",
  verticalAlign: "middle",
  borderBottom: "[1px solid token(colors.bg.secondary-highlight)]",
  textStyle: "paragraph.sm.default",
  bg: "bg.secondary",
});
const stickyFirst = css({
  position: "sticky",
  left: "0",
  zIndex: "[2]",
  borderRight: "[1px solid token(colors.bg.secondary-highlight)]",
});
export default function RecommendationsGridRecipients({
  rows,
  catalogs,
  gridSearch,
}: {
  rows: RecommendationRow[];
  catalogs: MacroSector[];
  /** Carried by the Editar links, so the correction screen can come back. */
  gridSearch: RecommendationsGridSearch;
}) {
  const { t } = useTranslation("recommendations");
  const editLabel = t("grilla.columns.edit");
  return (
    <table
      className={css({
        width: "full",
        borderCollapse: "separate",
        borderSpacing: "0",
      })}
    >
      <thead>
        <tr>
          {(
            [
              "recommendationNumber",
              "role",
              "name",
              "position",
              "unit",
              "sector",
              "edit",
            ] as const
          ).map((column, index) => (
            <th
              key={column}
              scope="col"
              className={cx(tableHeadCell, index === 0 && stickyFirstHeadCell)}
            >
              {t(
                column === "recommendationNumber" || column === "edit"
                  ? `grilla.columns.${column}`
                  : `grilla.recipients.${column}`,
              )}
            </th>
          ))}
        </tr>
      </thead>
      {rows.map((row) => {
        const primary = primaryRecipient(row.recipients);
        const recipients = primary
          ? [
              primary,
              ...row.recipients.filter(
                (recipient) => recipient.id !== primary.id,
              ),
            ]
          : [];
        return (
          <tbody key={row.id} aria-label={row.recommendation_number ?? row.id}>
            {recipients.length === 0 ? (
              <tr>
                <th scope="row" className={cx(cell, stickyFirst)}>
                  {row.recommendation_number ?? "—"}
                </th>
                <td colSpan={5} className={cell}>
                  {t("grilla.recipients.empty")}
                </td>
                <td className={cell}>
                  <RecommendationEditLink
                    recommendationId={row.id}
                    label={editLabel}
                    gridSearch={gridSearch}
                  />
                </td>
              </tr>
            ) : (
              recipients.map((recipient, index) => (
                <tr key={recipient.id}>
                  {index === 0 && (
                    <th
                      scope="rowgroup"
                      rowSpan={recipients.length}
                      className={cx(cell, stickyFirst)}
                    >
                      {row.recommendation_number ?? "—"}
                    </th>
                  )}
                  <td className={cell}>
                    {t(
                      index === 0
                        ? "grilla.recipients.primary"
                        : "grilla.recipients.secondary",
                    )}
                  </td>
                  <td className={cell}>{recipient.name ?? "—"}</td>
                  <td className={cell}>{recipient.position ?? "—"}</td>
                  <td className={cell}>{recipient.unit_name ?? "—"}</td>
                  <td className={cell}>
                    {recipientSector(recipient, catalogs) ?? "—"}
                  </td>
                  {index === 0 && (
                    <td rowSpan={recipients.length} className={cell}>
                      <RecommendationEditLink
                        recommendationId={row.id}
                        label={editLabel}
                        gridSearch={gridSearch}
                      />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        );
      })}
    </table>
  );
}
