/**
 * ISO date or timestamp → `dd/mm/aaaa`, the format an es-AR reader expects.
 *
 * Formatted in UTC on purpose: a date is read as a calendar day, and
 * rendering `2026-08-28T00:00:00Z` in UTC-3 would show it as the 27th. A bare
 * `YYYY-MM-DD` parses as UTC midnight, so the same rule keeps it on its day.
 *
 * Shared between the organigram holder dates (`settings/holder-format.ts`)
 * and the Recomendaciones date fields -- both read a stored ISO date and
 * need the same es-AR display format.
 */
export function formatDisplayDate(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * A datetime carrying no timezone designator: `YYYY-MM-DDThh:mm(:ss(.sss))`
 * and nothing after it. Anything ending in `Z` or a `±HH:MM` offset already
 * says which instant it is, and a bare `YYYY-MM-DD` (no `T`) is read as UTC
 * midnight by the spec — neither needs the `Z` appended.
 */
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T[\d:.]+$/;

/**
 * ISO datetime → `dd/mm/aaaa, hh:mm` in the reader's own timezone.
 *
 * For a *timestamp* ("última edición"), unlike `formatDisplayDate`'s calendar
 * days. Two deliberate differences:
 *
 * 1. The API serializes `created_at`/`updated_at` naive, with no designator
 *    (`"2026-09-22T23:30:00"`), while the instant it stores is UTC (SQLite's
 *    `CURRENT_TIMESTAMP` and `func.now()` both are). `Date` would read an
 *    offset-less ISO string as *local* time, so the `Z` is appended first.
 * 2. Rendered in the system timezone, not UTC: the export does the same
 *    (`_to_local_date` in `data_extraction_export.py`), and in Argentina
 *    (UTC-3) anything touched after 21:00 UTC would otherwise be shown a day
 *    late — a 6pm edit, not an edge case.
 */
export function formatDisplayTimestamp(isoTimestamp: string): string {
  const normalized = NAIVE_DATETIME.test(isoTimestamp)
    ? `${isoTimestamp}Z`
    : isoTimestamp;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}
