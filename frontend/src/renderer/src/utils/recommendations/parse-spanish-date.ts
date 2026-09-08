/**
 * Ports `_parse_spanish_prose_date` (`aymurai/database/crud/recommendation.py`)
 * to seed the date-picker field's initial value client-side from the
 * model's raw prose. Deliberately narrow: only the one shape the extraction
 * prompt asks for ("DD de MES de YYYY") -- anything else returns `null` and
 * the person fills the date in by hand.
 */
const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const PROSE_DATE_PATTERN =
  /(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de[l]?\s+(\d{4})/i;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function parseSpanishProseDate(text: string | null): string | null {
  if (!text) return null;
  const match = PROSE_DATE_PATTERN.exec(text);
  if (!match) return null;

  const day = Number.parseInt(match[1], 10);
  const month = SPANISH_MONTHS[match[2].toLowerCase()];
  const year = Number.parseInt(match[3], 10);
  if (month === undefined) return null;

  const parsed = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  if (!roundTrips) return null;

  return `${year}-${pad2(month)}-${pad2(day)}`;
}
