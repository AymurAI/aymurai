import type {
  RecipientFormValues,
  RecommendationFormValues,
} from "@/types/dataExtraction";

/** Every name is also a key under `validation` in the `recommendations` i18n
 *  bundle, so the warning names a field exactly as its own label does. */
export type PendingValidationFieldName =
  | "recommendationNumber"
  | "recommendationDate"
  | "topic"
  | "subtopic"
  | "macroSector"
  | "name"
  | "position"
  | "unit";

export interface PendingValidationField {
  labelKey: PendingValidationFieldName;
  /** 0-based index into `values.recipients`; absent for a top-level field. */
  recipientIndex?: number;
}

/** The same question every `Validated*Field` asks to decide whether to render
 *  its clickable mark (`hasSuggestion = !value && !!suggestion`, see
 *  `components/recommendations/validated-text-field.tsx`): a field is pending
 *  exactly while the model's answer is still the only one there. */
function isPending(value: string | null, suggestion: string | null): boolean {
  return !value && !!suggestion;
}

const TOP_LEVEL_FIELDS: {
  labelKey: PendingValidationFieldName;
  read: (values: RecommendationFormValues) => string | null;
}[] = [
  { labelKey: "recommendationNumber", read: (v) => v.recommendation_number },
  { labelKey: "recommendationDate", read: (v) => v.recommendation_date },
  { labelKey: "topic", read: (v) => v.topic },
  { labelKey: "subtopic", read: (v) => v.subtopic },
];

const RECIPIENT_FIELDS: {
  labelKey: PendingValidationFieldName;
  read: (recipient: RecipientFormValues) => string | null;
}[] = [
  { labelKey: "macroSector", read: (r) => r.macro_sector },
  { labelKey: "name", read: (r) => r.name },
  { labelKey: "position", read: (r) => r.position },
  // ADR-0013: `unit_id`/`sector_id` are only ever blanked and filled together,
  // so the pair is one pending field, named after the unit -- the control the
  // person actually picks (`RecipientUnitCombobox`; the sector follows).
  { labelKey: "unit", read: (r) => r.unit_id },
];

/**
 * The fields ADR-0013 starts blank that are still blank while the model's
 * suggestion stands — i.e. everything that would be saved empty right now
 * without anyone having decided so.
 *
 * Both lists are ordered the way the form renders them (top-level fields in
 * `recommendation-form.tsx`, recipient fields in `recipient-fields.tsx`), so
 * a person reading the warning can walk the screen top to bottom.
 *
 * A field the model left empty is never reported: there is no suggestion to
 * validate, so a blank there is just a blank. The fields ADR-0013 leaves
 * pre-filled (`personal_data`, `is_primary`, `publishable_content`) and the
 * never-edited `recommendation_date_text` are outside the question entirely.
 */
export function findPendingValidationFields(
  values: RecommendationFormValues,
  suggestions: RecommendationFormValues,
): PendingValidationField[] {
  const pending: PendingValidationField[] = [];

  for (const field of TOP_LEVEL_FIELDS) {
    if (isPending(field.read(values), field.read(suggestions))) {
      pending.push({ labelKey: field.labelKey });
    }
  }

  values.recipients.forEach((recipient, recipientIndex) => {
    // A hand-added recipient has no frozen inference paired to it.
    const suggestion = suggestions.recipients[recipientIndex];
    if (!suggestion) return;

    for (const field of RECIPIENT_FIELDS) {
      if (isPending(field.read(recipient), field.read(suggestion))) {
        pending.push({ labelKey: field.labelKey, recipientIndex });
      }
    }
  });

  return pending;
}
