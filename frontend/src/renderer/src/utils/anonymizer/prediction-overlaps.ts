import type { PredictLabel } from "@/types/aymurai";

interface CharRange {
  start_char: number;
  end_char: number;
}

export interface OverlapConflict {
  candidate: PredictLabel;
  existing: PredictLabel;
}

/**
 * Checks whether two half-open character ranges intersect.
 */
export function rangesOverlap(a: CharRange, b: CharRange) {
  return a.start_char < b.end_char && b.start_char < a.end_char;
}

/**
 * Checks whether a candidate batch contains mutually overlapping predictions
 * within the same paragraph.
 */
export function hasInternalOverlap(predictions: PredictLabel[]) {
  const byParagraph = new Map<string, PredictLabel[]>();
  for (const prediction of predictions) {
    const paragraphPredictions = byParagraph.get(prediction.paragraphId) ?? [];
    paragraphPredictions.push(prediction);
    byParagraph.set(prediction.paragraphId, paragraphPredictions);
  }

  for (const paragraphPredictions of byParagraph.values()) {
    const sorted = [...paragraphPredictions].sort(
      (a, b) => a.start_char - b.start_char,
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous && current && rangesOverlap(previous, current)) return true;
    }
  }

  return false;
}

/**
 * Finds the first candidate that overlaps an existing prediction in the same
 * paragraph.
 *
 * All existing predictions are considered, including the ones hidden by
 * excluded tags or terms: a latent overlap would otherwise block the export
 * later with no visible counterpart in the document view.
 */
export function findOverlapConflict(
  existing: PredictLabel[],
  candidates: PredictLabel[],
): OverlapConflict | null {
  const byParagraph = new Map<string, PredictLabel[]>();
  for (const prediction of existing) {
    const paragraphPredictions = byParagraph.get(prediction.paragraphId) ?? [];
    paragraphPredictions.push(prediction);
    byParagraph.set(prediction.paragraphId, paragraphPredictions);
  }

  for (const candidate of candidates) {
    const paragraphPredictions = byParagraph.get(candidate.paragraphId) ?? [];
    const conflicting = paragraphPredictions.find((prediction) =>
      rangesOverlap(candidate, prediction),
    );
    if (conflicting) return { candidate, existing: conflicting };
  }

  return null;
}
