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
