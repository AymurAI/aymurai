import { Suggestion } from "@aymurai/ui";
import { useId } from "react";
import { css, cx } from "@/styled/css";
import { Stack } from "@/styled/jsx";

export interface ValidatedTextFieldProps {
  label: string;
  value: string;
  /** The frozen model suggestion for this field, if any. */
  suggestion?: string | null;
  onChange: (value: string) => void;
}

const container = css({ gap: "1", width: "full" });

// Matches `@aymurai/ui`'s `TextField`/`Select`/`Textarea` field-label
// convention (`label.sm.default`) -- this component's own `input` text
// below stays `label.md.default`, same split those components use.
const labelStyle = css({
  textStyle: "label.sm.default",
  color: "text.lighter",
});

// Mirrors `@aymurai/ui`'s `TextField` box recipe (label above a bordered,
// rounded row) so a field with a suggestion still reads as the same kind of
// control as one without -- but built locally, since that library's own
// `suggestion` slot is a non-shrinking, non-interactive `<mark>` with no way
// to wrap long text or attach a click handler (an external package, not
// forkable from this repo).
const inputBox = css({
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: "2",
  p: "3",
  minH: "12",
  rounded: "sm",
  border: "primary",
  bg: "bg.secondary",
  "&:focus-within": {
    outline: "none",
    border: "primary-alt",
    boxShadow: "input-focus",
  },
});

const inputBoxWithSuggestion = css({
  border: "secondary",
});

const input = css({
  textStyle: "label.md.default",
  borderWidth: "0",
  outline: "none",
  flex: "[1]",
  minW: "0",
  bg: "[transparent]",
  color: "text.default",
});

// Same shape as the library's own suffix slot: a vertical divider (its
// `brand.secondary` border-left) separating the input from the suggestion.
const suggestionSlot = css({
  display: "flex",
  alignItems: "center",
  flexShrink: "0",
  maxW: "[60%]",
  borderLeftWidth: "1",
  borderLeftStyle: "solid",
  borderLeftColor: "brand.secondary",
  pl: "2",
});

const suggestionButton = css({
  display: "inline-block",
  whiteSpace: "normal",
  overflowWrap: "break-word",
  textAlign: "left",
  cursor: "pointer",
  border: "[none]",
  bg: "[transparent]",
  p: "0",
  font: "inherit",
});

/**
 * Renders the same violet, vertical-bar-separated suggestion mark as the
 * legacy Set de Datos flow's `uncontrolled-input` (`suggestion` prop on
 * `@aymurai/ui`'s `TextField`), rebuilt locally so it can wrap a long value
 * instead of overflowing and can actually be clicked.
 *
 * Shown only while `value` is still empty -- matching the legacy
 * component's own gating exactly. `useRecommendationForm` now seeds these
 * fields blank (`blankTextFields`) rather than pre-filled with the same
 * text as `suggestion`, so this is meaningful: the model's guess appears
 * ONLY here until the person clicks it (accepting it into `value`, which
 * then hides the mark) or types their own answer (which hides it too).
 */
export function ValidatedTextField({
  label,
  value,
  suggestion,
  onChange,
}: ValidatedTextFieldProps) {
  const id = useId();
  const hasSuggestion = !value && !!suggestion;

  return (
    <Stack className={container}>
      <label className={labelStyle} htmlFor={id}>
        {label}
      </label>
      <div className={cx(inputBox, hasSuggestion && inputBoxWithSuggestion)}>
        <input
          id={id}
          className={input}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {hasSuggestion && (
          <div className={suggestionSlot}>
            <Suggestion
              as="button"
              type="button"
              clickable
              className={suggestionButton}
              onClick={() => onChange(suggestion)}
            >
              {suggestion}
            </Suggestion>
          </div>
        )}
      </div>
    </Stack>
  );
}
