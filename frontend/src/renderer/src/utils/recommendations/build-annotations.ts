import type { ExtractedValueAnnotation } from "@/components/file-annotator/types";
import type {
  DataExtractionPrediction,
  RecommendationValidationInput,
} from "@/types/dataExtraction";
import type { Paragraph } from "@/types/file";
import { locateValue } from "./locate-value";

/**
 * Fields eligible for highlighting, in emission order. `topic`, `subtopic`,
 * a recipient's sector and `personal_data`/`publishable_content` are
 * classifications/LLM syntheses rather than quotations from the source
 * document, so they are intentionally excluded (see plan §5.3).
 *
 * The highlight is a "why does this field say what it says" reference, not
 * a to-do marker -- it stays on regardless of whether the person has
 * confirmed the suggestion, and for the three free-text fields
 * (`recommendation_number`, a recipient's `name`/`position`) it tracks
 * whatever they currently have on screen: `payload`'s live value if they've
 * typed or accepted one, falling back to the model's own suggestion while
 * the field is still blank. `recommendation_date` is the one exception --
 * always searched via `prediction.recommendation_date` (the raw prose,
 * never itself edited: PLAN.md §D.3 conserves it verbatim), since there is
 * no "the person's own text" to prefer for a field whose editable
 * counterpart is a parsed ISO date, not prose that could appear in the
 * document.
 */
/**
 * What the field currently shows: the person's own value once they have typed
 * or accepted one, and the model's suggestion while it is still blank.
 *
 * A blank check, not `??`: clearing a field writes `""`, not `null`, and an
 * empty string is not nullish. With `??` the highlight vanished the moment
 * someone erased a field -- even though the suggestion mark came back right
 * next to it, since that mark keys off the same emptiness. The reference and
 * the mark have to agree about what the field is offering.
 */
function shownValue(
  typed: string | null | undefined,
  suggested: string | null | undefined,
): string {
  if (typed?.trim()) return typed;
  return suggested ?? "";
}

function fieldsToLocate(
  prediction: DataExtractionPrediction,
  payload: RecommendationValidationInput | null,
): { field: string; value: string }[] {
  const fields: { field: string; value: string }[] = [
    {
      field: "recommendation_number",
      value: shownValue(
        payload?.recommendation_number,
        prediction.recommendation_number,
      ),
    },
    {
      field: "recommendation_date",
      value: prediction.recommendation_date ?? "",
    },
  ];

  // A manually-added recipient (`addRecipient`, `useRecommendationForm.ts`)
  // is appended to `values.recipients` with no counterpart in
  // `prediction.recipients` at all -- iterate to the longer of the two so
  // its name/position, sourced entirely from `payload`, still get located.
  const recipientCount = Math.max(
    prediction.recipients.length,
    payload?.recipients.length ?? 0,
  );
  for (let index = 0; index < recipientCount; index++) {
    const recipient = prediction.recipients[index];
    const payloadRecipient = payload?.recipients[index];
    fields.push({
      field: `recipient:${index}:name`,
      value: shownValue(payloadRecipient?.name, recipient?.name),
    });
    fields.push({
      field: `recipient:${index}:position`,
      value: shownValue(payloadRecipient?.position, recipient?.position),
    });
  }

  return fields.filter(({ value }) => value.trim().length > 0);
}

/**
 * `generateSplits` (file-annotator) does not tolerate overlapping ranges for
 * arbitrary annotation types: its `isRightConflicting` check silently drops
 * (does not render) any token whose start falls before the end of the last
 * accepted split. Only "search"-over-"tag" overlaps get special merge
 * treatment via `mergeSearchIntoTags`; "extracted" annotations get none.
 * So overlap resolution here is load-bearing, not just defence-in-depth:
 * without it, later-emitted overlapping annotations would simply vanish
 * from the rendered document instead of being handled gracefully.
 */
function dedupeOverlaps(
  annotations: ExtractedValueAnnotation[],
): ExtractedValueAnnotation[] {
  const sorted = [...annotations].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });

  const accepted: ExtractedValueAnnotation[] = [];
  for (const annotation of sorted) {
    const overlapsAccepted = accepted.some(
      (existing) =>
        annotation.start < existing.end && existing.start < annotation.end,
    );
    if (!overlapsAccepted) accepted.push(annotation);
  }

  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * Locates each highlightable extracted-value field in the document's
 * paragraphs and turns the resulting ranges into `ExtractedValueAnnotation`s,
 * grouped by paragraph id. Within each paragraph, overlapping annotations are
 * resolved by keeping the earliest-starting (then longest) candidate and
 * dropping anything that overlaps it.
 */
export function buildAnnotations(
  prediction: DataExtractionPrediction,
  paragraphs: Paragraph[],
  payload: RecommendationValidationInput | null = null,
): Map<string, ExtractedValueAnnotation[]> {
  const byParagraph = new Map<string, ExtractedValueAnnotation[]>();

  for (const { field, value } of fieldsToLocate(prediction, payload)) {
    // Every occurrence, not `locateValue`'s default first three. The
    // highlight answers "where in the document does this come from", and a
    // cap answers it for part of the document only: a name appearing five
    // times highlighted at its first three leaves the other two dark, which
    // reads as the matcher failing rather than as a limit. Worse, narrowing
    // the search (typing a character that happens to occur beside only one
    // of them) made the missing ones appear -- the cap looked like a
    // matching bug from every angle except the one that explains it.
    const ranges = locateValue(value, paragraphs, {
      maxMatches: Number.POSITIVE_INFINITY,
    });
    for (const range of ranges) {
      const annotation: ExtractedValueAnnotation = {
        type: "extracted",
        paragraphId: range.paragraphId,
        start: range.start,
        end: range.end,
        field,
        variant: "value",
      };
      const existing = byParagraph.get(range.paragraphId) ?? [];
      existing.push(annotation);
      byParagraph.set(range.paragraphId, existing);
    }
  }

  const result = new Map<string, ExtractedValueAnnotation[]>();
  for (const [paragraphId, annotations] of byParagraph) {
    result.set(paragraphId, dedupeOverlaps(annotations));
  }

  return result;
}
