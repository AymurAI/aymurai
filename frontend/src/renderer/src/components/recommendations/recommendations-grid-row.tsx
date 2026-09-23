import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { css, cx } from "@/styled/css";
import type {
  RecipientDetail,
  RecommendationRow,
} from "@/types/dataExtraction";
import { formatDisplayDate, formatDisplayTimestamp } from "@/utils/format-date";
import {
  EditableSelectCell,
  EditableTextCell,
} from "./recommendations-grid-cells";
import type { ColumnId } from "./recommendations-grid-columns";

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
  verticalAlign: "top",
  textStyle: "paragraph.sm.default",
  color: "text.default",
  borderBottomWidth: "1",
  borderBottomStyle: "solid",
  borderBottomColor: "bg.primary",
});

const noWrap = css({ whiteSpace: "nowrap" });

const muted = css({ color: "text.lighter" });

const secondaryLine = css({
  display: "block",
  textStyle: "paragraph.xsm.default",
  color: "text.lighter",
});

const correctButton = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  px: "2",
  py: "1",
  borderRadius: "sm",
  textStyle: "cta.sm.strong",
  color: "text.onbutton-default",
  bg: "action.default",
  textDecoration: "none",
  border: "none",
  cursor: "pointer",
  transition: "[background-color 200ms]",
  _hover: { bg: "action.hover" },
  _focusVisible: { outline: "[2px solid token(colors.action.focus)]" },
});

const EMPTY = "—";

/** `is_primary` is the field the export reads as the main destinatario; the
 *  first recipient is the fallback for the rows saved before it existed. */
function primaryRecipient(
  recipients: RecipientDetail[],
): RecipientDetail | null {
  return (
    recipients.find((recipient) => recipient.is_primary) ??
    recipients[0] ??
    null
  );
}

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
}

export default function RecommendationsGridRow({
  row,
  situations,
  statuses,
  catalogsReady,
  hasFailed,
  saveFailedMessage,
  onEdit,
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
      <td className={cx(cell, noWrap)}>
        {row.recommendation_number ?? <span className={muted}>{EMPTY}</span>}
      </td>
      <td className={cx(cell, noWrap)}>
        {row.recommendation_date ? (
          formatDisplayDate(row.recommendation_date)
        ) : (
          // Nothing parsed: show the prose the model read, so the row is
          // still identifiable while the `unparsedDates` filter is what
          // gathers these up for fixing.
          <span className={muted}>{row.recommendation_date_text ?? EMPTY}</span>
        )}
      </td>
      <td className={cell}>
        {row.topic ?? <span className={muted}>{EMPTY}</span>}
      </td>
      <td className={cell}>
        {row.subtopic ?? <span className={muted}>{EMPTY}</span>}
      </td>
      <td className={cell}>
        {recipient ? (
          <>
            {recipient.name ?? recipient.position ?? EMPTY}
            {recipient.sector_name && (
              <span className={secondaryLine}>{recipient.sector_name}</span>
            )}
          </>
        ) : (
          <span className={muted}>{EMPTY}</span>
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
        <Link
          to="/home/dataset/$recommendationId"
          params={{ recommendationId: row.id }}
          className={correctButton}
        >
          {t("grilla.columns.correct")}
        </Link>
      </td>
    </tr>
  );
}
