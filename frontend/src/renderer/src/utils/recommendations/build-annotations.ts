import type { ExtractedValueAnnotation } from "@/components/file-annotator/types";
import type {
  DataExtractionPrediction,
  RecommendationValidationInput,
} from "@/types/dataExtraction";
import type { Paragraph } from "@/types/file";
import { locateValue } from "./locate-value";

/** Matches `fieldsToLocate`'s `recipient:{index}:{name|position}` naming. */
const RECIPIENT_FIELD = /^recipient:(\d+):(name|position)$/;

/**
 * `recommendation_number` and each recipient's `name`/`position` are the
 * only fields with a clickable suggestion mark next to them
 * (`ValidatedTextField`) -- while a field's value is still blank (the
 * suggestion showing, per `useRecommendationForm`'s `blankTextFields`), its
 * source-document highlight is worth keeping since it's still an open
 * question the person hasn't resolved. Once they've accepted the
 * suggestion or typed their own answer, the highlight has served its
 * purpose and would otherwise keep marking already-settled text as if it
 * still needed attention. Every other highlightable field
 * (`recommendation_date`) never carried a suggestion overlay to begin with,
 * so it always stays highlighted, as before.
 */
function isPending(
  field: string,
  payload: RecommendationValidationInput | null,
): boolean {
  if (!payload) return true;
  if (field === "recommendation_number") return !payload.recommendation_number;
  const match = RECIPIENT_FIELD.exec(field);
  if (!match) return true;
  const recipient = payload.recipients[Number(match[1])];
  const key = match[2] as "name" | "position";
  return !recipient?.[key];
}

/**
 * Fields eligible for highlighting, in emission order. `topic`, `subtopic`,
 * a recipient's sector and `personal_data`/`publishable_content` are
 * classifications/LLM syntheses rather than quotations from the source
 * document, so they are intentionally excluded (see plan §5.3).
 */
function fieldsToLocate(
  prediction: DataExtractionPrediction,
): { field: string; value: string }[] {
  const fields: { field: string; value: string }[] = [
    {
      field: "recommendation_number",
      value: prediction.recommendation_number ?? "",
    },
    {
      field: "recommendation_date",
      value: prediction.recommendation_date ?? "",
    },
  ];

  prediction.recipients.forEach((recipient, index) => {
    fields.push({
      field: `recipient:${index}:name`,
      value: recipient.name ?? "",
    });
    fields.push({
      field: `recipient:${index}:position`,
      value: recipient.position ?? "",
    });
  });

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

  for (const { field, value } of fieldsToLocate(prediction)) {
    if (!isPending(field, payload)) continue;
    const ranges = locateValue(value, paragraphs);
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
