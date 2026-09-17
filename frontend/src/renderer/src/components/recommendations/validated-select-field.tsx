import { Select } from "@aymurai/ui";
import type { MouseEvent } from "react";
import { css } from "@/styled/css";
import { Stack } from "@/styled/jsx";
import type { FormOption } from "@/types/dataExtraction";

export interface ValidatedSelectFieldProps {
  label: string;
  /** Live catalog entries plus any kept-and-flagged extra, from
   *  `useRecommendationForm`. */
  options: FormOption[];
  value: string | null;
  /** The frozen model suggestion for this field, if any. */
  suggestion?: string | null;
  /** Shown when the value on screen isn't in the live catalog. */
  outOfCatalogMessage: string;
  /** `null` when the person clears the field back to its suggestion. */
  onChange: (value: string | null) => void;
}

// `Select` (@aymurai/ui) has no `error` prop, unlike `TextField` -- render
// the out-of-catalog notice as its own text instead of silently discarding
// the model's value.
const errorText = css({
  textStyle: "label.sm.default",
  color: "system.error",
});

/** `value` isn't among `options`' non-flagged entries -- i.e. it's the
 *  out-of-catalog extra `useRecommendationForm` appended. */
function isOutOfCatalog(options: FormOption[], value: string | null): boolean {
  if (!value) return false;
  return options.some(
    (option) => option.value === value && option.outOfCatalog,
  );
}

function toSelectOptions(options: FormOption[]) {
  return options.map((option) => ({ id: option.value, text: option.label }));
}

/**
 * `ValidatedTextField`'s counterpart for a catalog field: the same violet,
 * clickable suggestion mark, shown only while `value` is still empty.
 *
 * Unlike the text and date fields, the mark itself comes from `@aymurai/ui`'s
 * own `Select`, which already renders the model's guess as a clickable
 * `Suggestion` inside the trigger whenever it has a `suggestion` and no
 * value. What kept it from ever appearing was upstream, not visual:
 * `useRecommendationForm` pre-filled topic/subtopic/macro_sector with the
 * very value it passed as the suggestion, so the "no value" branch was
 * unreachable. Blanking them there (`blankValidatedFields`) is what turns
 * this on -- this component exists for the two things the library's `Select`
 * can't do from outside.
 *
 * The first is the out-of-catalog notice, previously duplicated at both call
 * sites. It keys off what is ON SCREEN (`value ?? suggestion`), not off
 * `value` alone: with the field starting blank, flagging only the accepted
 * value would mean the person sees an odd suggestion with no warning and
 * only learns it is off-catalog after clicking it.
 *
 * The second is the clear (x) control. `Select` clears its own internal
 * state without calling `onChange`, so the field goes blank on screen -- the
 * suggestion mark even comes back -- while the form still holds the old
 * value, which is then what gets saved. That desync predates this change
 * (the suggestion prop was already wired) but clearing is now the natural
 * "put the suggestion back" gesture, so it goes from reachable to routine.
 * Since the clear and suggestion controls are mutually exclusive by
 * construction -- one renders only with a value, the other only without --
 * a click on any button inside the trigger while a value is set can only be
 * the clear, which the capture-phase handler below mirrors into
 * `onChange(null)`. Capture phase specifically: the library's own handler
 * calls `stopPropagation`, which cancels bubbling but not a capture handler
 * that has already run.
 */
export function ValidatedSelectField({
  label,
  options,
  value,
  suggestion,
  outOfCatalogMessage,
  onChange,
}: ValidatedSelectFieldProps) {
  const shownValue = value ?? suggestion ?? null;

  const handleClearCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!value) return;
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest("button")) return;
    onChange(null);
  };

  return (
    <Stack gap="1" onClickCapture={handleClearCapture}>
      <Select
        label={label}
        options={toSelectOptions(options)}
        value={value ?? undefined}
        suggestion={suggestion ? { id: suggestion } : undefined}
        onChange={(option) => onChange(option.id)}
      />
      {isOutOfCatalog(options, shownValue) && (
        <p className={errorText}>{outOfCatalogMessage}</p>
      )}
    </Stack>
  );
}
