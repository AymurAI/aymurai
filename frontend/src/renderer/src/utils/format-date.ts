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
