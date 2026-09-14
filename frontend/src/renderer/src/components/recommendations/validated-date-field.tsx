import { Suggestion } from "@aymurai/ui";
import { useId } from "react";
import { css, cx } from "@/styled/css";
import { Stack } from "@/styled/jsx";
import { formatDisplayDate } from "@/utils/format-date";

export interface ValidatedDateFieldProps
  extends Omit<
      React.InputHTMLAttributes<HTMLInputElement>,
      "value" | "onChange" | "type" | "id"
    >,
    React.RefAttributes<HTMLInputElement> {
  label: string;
  /** The `YYYY-MM-DD` an `<input type="date">` needs, or `""` while blank. */
  value: string;
  /** The model's suggested date, as `YYYY-MM-DD`, if any. */
  suggestion?: string | null;
  onChange: (value: string) => void;
}

const container = css({ gap: "1", width: "full" });

const labelStyle = css({
  textStyle: "label.md.default",
  color: "text.lighter",
});

// Same box recipe as `ValidatedTextField` -- see that file's comment for why
// this is built locally instead of reusing `@aymurai/ui`'s `TextField`
// `suggestion` slot (non-clickable, non-wrapping).
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
 * `ValidatedTextField`'s counterpart for a date: same violet, clickable
 * suggestion mark, shown only while `value` is still empty -- but the mark
 * displays the suggestion formatted as `dd/mm/aaaa` (`formatDisplayDate`)
 * while accepting it sets `value` to the raw `YYYY-MM-DD` the native
 * `<input type="date">` actually needs.
 *
 * Picking any date from the native calendar also sets `value` directly
 * (via `onChange`), which hides the suggestion the same way accepting it
 * does -- so "confirm the suggestion" and "pick a different date" both just
 * fill the same field, matching every other validated field in this form.
 *
 * Known, accepted limitation: the native calendar popup always opens
 * anchored to the input's own left edge, never the calendar-icon button on
 * the right -- confirmed there is no CSS/HTML control over this (including
 * a `direction: rtl` attempt, which didn't even move the icon). Fixing it
 * would mean replacing the native input with a fully custom date picker.
 */
export function ValidatedDateField({
  label,
  value,
  suggestion,
  onChange,
  ref,
  ...props
}: ValidatedDateFieldProps) {
  const id = useId();
  const hasSuggestion = !value && !!suggestion;

  return (
    <Stack className={container}>
      <label className={labelStyle} htmlFor={id}>
        {label}
      </label>
      <div className={cx(inputBox, hasSuggestion && inputBoxWithSuggestion)}>
        <input
          {...props}
          ref={ref}
          id={id}
          type="date"
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
              {formatDisplayDate(suggestion)}
            </Suggestion>
          </div>
        )}
      </div>
    </Stack>
  );
}
