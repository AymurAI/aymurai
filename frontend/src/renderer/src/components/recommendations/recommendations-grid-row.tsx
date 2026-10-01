import { useTranslation } from "react-i18next";
import { css, cx } from "@/styled/css";
import type { MacroSector } from "@/types/catalogs";
import type { RecommendationRow } from "@/types/dataExtraction";
import { formatDisplayDate, formatDisplayTimestamp } from "@/utils/format-date";
import PublishableContentPreview from "./publishable-content-preview";
import { primaryRecipient, RecipientDisplay } from "./recipient-display";
import RecommendationEditLink from "./recommendation-edit-link";
import {
  EditableSelectCell,
  EditableTextCell,
} from "./recommendations-grid-cells";
import type { ColumnId } from "./recommendations-grid-columns";
import type { RecommendationsGridSearch } from "./recommendations-grid-search";

/**
 * The body of one PATCH to `/recommendations/{id}`: only the keys the person
 * actually touched. An absent key means "leave it alone" (`exclude_unset`
 * server-side), an explicit `null` means "erase it" — which is why every
 * editor here commits `null` rather than `""`.
 */
export type RecommendationSeguimientoPatch = Partial<{
  file_number: string | null;
  recommendation_detail: string | null;
  recommendation_situation: string | null;
  status: string | null;
  approved_for_publication: boolean | null;
  link: string | null;
}>;

/** One of the six seguimiento columns, by its API name. */
export type SeguimientoField = keyof RecommendationSeguimientoPatch;

const cell = css({
  px: "3",
  py: "2",
  verticalAlign: "middle",
  textAlign: "left",
  textStyle: "paragraph.sm.default",
  color: "text.default",
  borderBottomWidth: "1",
  borderBottomStyle: "solid",
  borderBottomColor: "bg.secondary-highlight",
});

const stickyFirst = css({
  position: "sticky",
  left: "0",
  zIndex: "[2]",
  bg: "bg.secondary",
  borderRightWidth: "1",
  borderRightStyle: "solid",
  borderRightColor: "bg.secondary-highlight",
});

const noWrap = css({ whiteSpace: "nowrap" });

const muted = css({ color: "text.lighter" });

const EMPTY = "—";

/**
 * `approved_for_publication` is a tri-state (`true` / `false` / never
 * answered), so it is edited as a two-option `Select` rather than a checkbox:
 * clearing it is what puts it back to "unanswered". The two labels are UI
 * copy, not a server catalog — unlike `status`/`recommendation_situation`,
 * which must come from `recommendationEnums()` (issue #58).
 */
const APPROVED_YES = "yes";
const APPROVED_NO = "no";

interface RecommendationsGridRowProps {
  row: RecommendationRow;
  macroSectors: MacroSector[];
  /** `recommendationEnums().situations`, never a list written in TS. */
  situations: string[];
  /** `recommendationEnums().statuses`, never a list written in TS. */
  statuses: string[];
  /**
   * False while `recommendationEnums()` has not answered (or failed): the two
   * catalog cells lock, so nobody can clear a value out of a picker that has
   * nothing to put back.
   */
  catalogsReady: boolean;
  /** True for a field whose last save failed and is still unsaved. */
  hasFailed: (field: SeguimientoField) => boolean;
  /** Inline mark for such a field — the grid owns the wording. */
  saveFailedMessage: string;
  /**
   * One edit is one PATCH of one key, so nothing here locks while a save is
   * in flight: greying the row out would pull the focus out from under
   * somebody already typing in the next cell, and two PATCHes to different
   * keys of the same row merge server-side (`exclude_unset`) rather than
   * racing. A failure surfaces as the grid's own banner instead.
   */
  onEdit: (patch: RecommendationSeguimientoPatch) => void;
  /** Carried by the Editar link, so the correction screen can come back. */
  gridSearch: RecommendationsGridSearch;
}

export default function RecommendationsGridRow({
  row,
  macroSectors,
  situations,
  statuses,
  catalogsReady,
  hasFailed,
  saveFailedMessage,
  onEdit,
  gridSearch,
}: RecommendationsGridRowProps) {
  const { t } = useTranslation("recommendations");

  // The row's own name, used to qualify every cell's accessible label so the
  // twelve "Estado" controls on a page are told apart. Joined in TS rather
  // than through an interpolated key: the separator is punctuation, and the
  // recommendation number is data, not copy.
  const rowLabel = row.recommendation_number ?? row.id;
  const label = (column: ColumnId) =>
    `${t(`grilla.columns.${column}`)} · ${rowLabel}`;

  const recipient = primaryRecipient(row.recipients);

  // The grilla's "última edición": `updated_at` once anybody has touched the
  // row, the moment it was registered otherwise. `formatDisplayTimestamp`,
  // not `formatDisplayDate`: these two come off the wire naive (no `Z`) and
  // mean a UTC instant, so reading them as a calendar day in UTC would date
  // any late-afternoon edit in Argentina to the following day — the export
  // (`_to_local_date`) already gets this right, and the two must agree.
  const lastEdited = formatDisplayTimestamp(row.updated_at ?? row.created_at);

  /** `undefined` (not `null`) so an unfailed cell passes no error at all. */
  const errorFor = (field: SeguimientoField) =>
    hasFailed(field) ? saveFailedMessage : undefined;

  const approvedValue =
    row.approved_for_publication === null
      ? null
      : row.approved_for_publication
        ? APPROVED_YES
        : APPROVED_NO;

  return (
    <tr>
      <td className={cx(cell, noWrap, stickyFirst)}>
        {row.recommendation_number ?? <span className={muted}>{EMPTY}</span>}
      </td>
      <td className={cx(cell, noWrap)}>
        {row.recommendation_date ? (
          formatDisplayDate(row.recommendation_date)
        ) : (
          // Nothing parsed: show the prose the model read so the row remains
          // identifiable and the original value is not hidden.
          <span className={muted}>{row.recommendation_date_text ?? EMPTY}</span>
        )}
      </td>
      <td className={cell}>
        {row.topic ?? <span className={muted}>{EMPTY}</span>}
      </td>
      <td className={cell}>
        {row.subtopic ?? <span className={muted}>{EMPTY}</span>}
      </td>
      <td className={cx(cell, css({ minW: "[240px]", maxW: "[320px]" }))}>
        {recipient ? (
          <RecipientDisplay recipient={recipient} catalogs={macroSectors} />
        ) : (
          <span className={muted}>{EMPTY}</span>
        )}
      </td>
      <td className={cx(cell, css({ minW: "[300px]", maxW: "[360px]" }))}>
        {row.publishable_content ? (
          <PublishableContentPreview
            content={row.publishable_content}
            label={t("grilla.columns.publishableContent")}
          />
        ) : (
          <span className={muted}>{EMPTY}</span>
        )}
      </td>
      <td className={cx(cell, noWrap)}>
        {/* Tri-state, like the export's DATOS_PERSONALES: never answered is
            blank, not "No". Same wording as the validation form. */}
        {row.personal_data === null ? (
          <span className={muted}>{EMPTY}</span>
        ) : row.personal_data ? (
          t("validation.personalDataYes")
        ) : (
          t("validation.personalDataNo")
        )}
      </td>

      <td className={cell}>
        <EditableTextCell
          ariaLabel={label("fileNumber")}
          value={row.file_number}
          error={errorFor("file_number")}
          onCommit={(value) => onEdit({ file_number: value })}
        />
      </td>
      <td className={cell}>
        <EditableTextCell
          ariaLabel={label("recommendationDetail")}
          value={row.recommendation_detail}
          error={errorFor("recommendation_detail")}
          onCommit={(value) => onEdit({ recommendation_detail: value })}
        />
      </td>
      <td className={cell}>
        <EditableSelectCell
          ariaLabel={label("recommendationSituation")}
          options={situations.map((situation) => ({
            id: situation,
            text: situation,
          }))}
          value={row.recommendation_situation}
          disabled={!catalogsReady}
          error={errorFor("recommendation_situation")}
          onCommit={(value) => onEdit({ recommendation_situation: value })}
        />
      </td>
      <td className={cell}>
        <EditableSelectCell
          ariaLabel={label("status")}
          options={statuses.map((status) => ({ id: status, text: status }))}
          value={row.status}
          disabled={!catalogsReady}
          error={errorFor("status")}
          onCommit={(value) => onEdit({ status: value })}
        />
      </td>
      <td className={cell}>
        <EditableSelectCell
          ariaLabel={label("approvedForPublication")}
          options={[
            { id: APPROVED_YES, text: t("grilla.approved.yes") },
            { id: APPROVED_NO, text: t("grilla.approved.no") },
          ]}
          value={approvedValue}
          error={errorFor("approved_for_publication")}
          onCommit={(value) =>
            onEdit({
              approved_for_publication:
                value === null ? null : value === APPROVED_YES,
            })
          }
        />
      </td>
      <td className={cell}>
        <EditableTextCell
          ariaLabel={label("link")}
          value={row.link}
          error={errorFor("link")}
          onCommit={(value) => onEdit({ link: value })}
        />
      </td>
      <td className={cx(cell, noWrap, muted)}>{lastEdited}</td>
      <td className={cell}>
        <RecommendationEditLink
          recommendationId={row.id}
          label={t("grilla.columns.edit")}
          gridSearch={gridSearch}
        />
      </td>
    </tr>
  );
}
