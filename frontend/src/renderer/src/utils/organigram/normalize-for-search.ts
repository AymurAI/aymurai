/**
 * Mirrors the backend's `normalize_text` (`aymurai/text/matching.py`): NFKD,
 * drop combining marks, lowercase, trim.
 *
 * People search the organigram without accents, so typing "habitat" has to
 * find "Hábitat". Beyond convenience, the backend already normalizes both
 * sides when it ranks cargos against unit names -- without this the
 * client-side filter would be strictly stricter than the ranking whose
 * results it sits next to.
 */
export function normalizeForSearch(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}
