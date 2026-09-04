const HONORIFICS = /\b(dra?|lic|mg|ing|cdor?a?|arq)\.?\s/gi;

/**
 * Two-letter monogram for a holder's `Avatar`. The organigram stores names both
 * as "Apellido, Nombre" and as "Nombre Apellido", so the comma is treated as a
 * separator rather than parsed as a surname-first convention.
 */
export function holderInitials(name: string): string {
  const parts = name
    .replace(/,/g, " ")
    .replace(HONORIFICS, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

/**
 * ISO date or timestamp → `dd/mm/aaaa`, the format an es-AR reader expects.
 *
 * Formatted in UTC on purpose: a term's start is read as a calendar day, and
 * rendering `2026-08-28T00:00:00Z` in UTC-3 would show it as the 27th. A bare
 * `YYYY-MM-DD` parses as UTC midnight, so the same rule keeps it on its day.
 */
export function holderDate(isoTimestamp: string): string {
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
 * The `YYYY-MM-DD` an `<input type="date">` needs, from a holder's term start
 * or — for a row written before term dates existed — the day it was recorded,
 * which is the date the screen has always shown for it.
 */
export function holderDateInputValue(holder: {
  start_date: string | null;
  created_at: string;
}): string {
  if (holder.start_date) return holder.start_date.slice(0, 10);
  const parsed = new Date(holder.created_at);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}
