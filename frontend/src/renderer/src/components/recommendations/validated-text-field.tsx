import { Suggestion, TextField } from "@aymurai/ui";
import { css } from "@/styled/css";
import { Stack } from "@/styled/jsx";

export interface ValidatedTextFieldProps {
  label: string;
  value: string;
  /** The frozen model suggestion for this field, if any. */
  suggestion?: string | null;
  onChange: (value: string) => void;
}

const suggestionButton = css({
  display: "inline-block",
  whiteSpace: "normal",
  overflowWrap: "break-word",
  textAlign: "left",
  cursor: "pointer",
  border: "[none]",
  p: "0",
});

/**
 * `TextField`'s own `suggestion` prop (from `@aymurai/ui`) renders a
 * non-shrinking, non-interactive suggestion mark inside the input box --
 * it overflows the container on a long value and does nothing on click.
 * This renders the same `Suggestion` mark ourselves, below the field,
 * wrapping normally and wired to actually accept the suggestion on click.
 */
export function ValidatedTextField({
  label,
  value,
  suggestion,
  onChange,
}: ValidatedTextFieldProps) {
  const showSuggestion = !!suggestion && suggestion !== value;

  return (
    <Stack gap="1">
      <TextField
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {showSuggestion && (
        <Suggestion
          as="button"
          type="button"
          clickable
          className={suggestionButton}
          onClick={() => onChange(suggestion)}
        >
          {suggestion}
        </Suggestion>
      )}
    </Stack>
  );
}
