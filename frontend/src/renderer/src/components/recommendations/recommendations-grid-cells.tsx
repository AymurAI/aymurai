import { Select, TextField } from "@aymurai/ui";
import { type MouseEvent, useLayoutEffect, useRef, useState } from "react";
import { css } from "@/styled/css";

/**
 * The two inline editors the grilla's seguimiento columns are built from.
 *
 * Both are deliberately "commit", not "change": the grid saves one field per
 * PATCH, so a cell has to say *when* it is done being edited. The text cell
 * commits on blur/Enter, the select on pick/clear -- and both report an
 * emptied field as an explicit `null`, which is what the backend reads as
 * "erase this" (an absent key means "leave untouched", `exclude_unset`).
 */

/** Keeps an editor from collapsing to its content width inside a `<td>`. */
const control = css({ minW: "[168px]" });

// `Select` has no `error` prop, unlike `TextField` -- same gap, and same
// local workaround, as `validated-select-field.tsx`.
const errorText = css({
  textStyle: "label.sm.default",
  color: "system.error",
});

export interface EditableTextCellProps {
  /** Accessible name — the column's label qualified by the row's. */
  ariaLabel: string;
  value: string | null;
  /**
   * Shown under the field and mirrored into `aria-invalid`. The grid passes
   * it when this cell's last save failed: the draft below still shows the
   * typed text, so without the mark the screen would claim a value the
   * server never accepted.
   */
  error?: string | null;
  /** `null` when the person left the cell empty: an explicit erase. */
  onCommit: (value: string | null) => void;
}

export function EditableTextCell({
  ariaLabel,
  value,
  error,
  onCommit,
}: EditableTextCellProps) {
  // A local echo of the server value, so typing doesn't wait on a round trip
  // and a commit doesn't flash the old text back while the list refetches.
  // Resynced from props the moment the server's own value changes — the
  // documented "adjust state during render" pattern — which is also what
  // puts the truth back on screen if a save fails.
  const [draft, setDraft] = useState(value ?? "");
  const [lastSeen, setLastSeen] = useState(value);
  if (lastSeen !== value) {
    setLastSeen(value);
    setDraft(value ?? "");
  }

  const commit = () => {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === (value ?? null)) return;
    onCommit(next);
  };

  return (
    <div className={control}>
      <TextField
        aria-label={ariaLabel}
        size="sm"
        error={error}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(value ?? "");
        }}
      />
    </div>
  );
}

export interface EditableSelectCellProps {
  /** Accessible name — the column's label qualified by the row's. */
  ariaLabel: string;
  /** Closed catalog, always from the server (never hardcoded here). */
  options: { id: string; text: string }[];
  value: string | null;
  /**
   * Locks the cell outright. The grid sets it when the catalog behind these
   * options could not be fetched: `Select` hides its own clear (×) while
   * disabled, which is exactly what has to happen — an empty picker would
   * otherwise let somebody erase a value they then could not put back.
   */
  disabled?: boolean;
  /** Shown under the field when this cell's last save failed. */
  error?: string | null;
  /** `null` when the person cleared the cell: an explicit erase. */
  onCommit: (value: string | null) => void;
}

export function EditableSelectCell({
  ariaLabel,
  options,
  value,
  disabled,
  error,
  onCommit,
}: EditableSelectCellProps) {
  // Keep-and-flag, minus the flag: Radix renders nothing for a value with no
  // matching item, so a stored value the catalog no longer offers would
  // simply vanish from the screen. Appending it keeps it visible and
  // re-selectable; a cell has no room for the inline notice
  // `ValidatedSelectField` shows for the same situation.
  const shown =
    value !== null && !options.some((option) => option.id === value)
      ? [...options, { id: value, text: value }]
      : options;

  // `Select`'s own `label` prop renders a `<label htmlFor>` pointing at its
  // trigger -- but the trigger is a `<div role="combobox">`, and `for` only
  // names *labelable* elements, so that label gives the control no accessible
  // name at all. The props are a closed list with no rest spread, so there is
  // no `aria-label` to pass either. Writing it onto the trigger afterwards is
  // the only way in from outside: React never removes an attribute it doesn't
  // manage, so it survives the library's re-renders. (In this grid the column
  // header is the visible name, so the label would have been hidden anyway --
  // here it is the *only* name, which is why it can't just be dropped.)
  const wrapper = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    wrapper.current
      ?.querySelector('[role="combobox"]')
      ?.setAttribute("aria-label", ariaLabel);
  }, [ariaLabel]);

  // `Select` clears its own internal state without calling `onChange`, so the
  // cell would go blank on screen while the row still held — and kept saving
  // — the old value. Same shim, and the same capture-phase reason, as
  // `validated-select-field.tsx`: the library's handler calls
  // `stopPropagation`, which cancels bubbling but not an already-run capture
  // handler. The options live in a portal outside this element, so the only
  // button a click here can reach is the trigger's clear (×).
  const handleClearCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!value) return;
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest("button")) return;
    onCommit(null);
  };

  return (
    <div ref={wrapper} className={control} onClickCapture={handleClearCapture}>
      <Select
        size="sm"
        options={shown}
        value={value ?? undefined}
        disabled={disabled}
        onChange={(option) => {
          if (option.id !== value) onCommit(option.id);
        }}
      />
      {error && <p className={errorText}>{error}</p>}
    </div>
  );
}
