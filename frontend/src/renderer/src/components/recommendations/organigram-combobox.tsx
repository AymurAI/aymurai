import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  Suggestion,
} from "@aymurai/ui";
import type { ReactNode } from "react";
import { useId, useRef, useState } from "react";
import { css, cx } from "@/styled/css";
import { Stack, styled } from "@/styled/jsx";

/** One pickable row. `path` is the root-to-self chain, hidden when it adds
 *  nothing (a root, whose path is just its own name). */
export interface OrganigramComboboxOption {
  id: string;
  name: string;
  path?: string;
}

export interface OrganigramComboboxSearch {
  /** Rows for the current query. The consumer owns which corpus is searched
   *  and how -- the unit picker searches the whole organigram (or one sector,
   *  when the person pinned one), the sector picker only `is_sector` rows. */
  run: (query: string) => OrganigramComboboxOption[];
  isLoading: boolean;
  isError: boolean;
  loadingLabel: string;
  errorLabel: string;
}

export interface OrganigramComboboxProps {
  label?: string;
  placeholder: string;
  /** Ranked rows shown while nothing has been typed. */
  options: OrganigramComboboxOption[];
  /** Shown instead when there is nothing ranked to offer. */
  emptyPrompt: string;
  search: OrganigramComboboxSearch;
  /** Display name of the current value; `null` shows the placeholder. */
  selectedLabel: string | null;
  /** Whether a value is set. Drives the suggestion mark (which only shows
   *  while the field is still empty) and the clear-on-erase behaviour. */
  hasValue: boolean;
  /** Name of the suggested row, shown as a clickable violet mark while the
   *  field is empty -- same affordance as `ValidatedTextField`. */
  suggestionLabel?: string | null;
  onAcceptSuggestion?: () => void;
  onPick: (id: string) => void;
  /** Called when the person erases the search back to empty and leaves,
   *  which un-sets the value the way clearing a text field does. */
  onClear: () => void;
  /** Rendered under the search results -- the unit picker puts its
   *  create-a-unit affordance here. */
  footer?: (query: string, resultCount: number) => ReactNode;
}

// Matches `@aymurai/ui`'s field-label convention (`label.sm.default`) --
// see `validated-text-field.tsx`'s identical comment.
const labelStyle = css({
  textStyle: "label.sm.default",
  color: "text.lighter",
});

// Mirrors `validated-text-field.tsx`'s `inputBox`/`input`/`suggestionSlot`
// split -- same bordered row, same violet clickable mark, so this field
// reads as the same kind of control as the others once a suggestion shows.
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
  "&::placeholder": { color: "text.lighter" },
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

// The library's popover surface sets no height cap and no overflow (its 400px
// cap belongs to `Select`'s own viewport, not to `Popover`), so a long list
// just grew past the viewport with no way to reach the rows below the fold.
// Radix publishes the room it actually has as a CSS var on the content
// element; capping the scroller to it means the panel fits whether it opens
// upward or downward, and scrolls internally instead of overflowing.
// `rounded` matches the surface so rows can't poke past its corners.
const resultList = css({
  maxHeight: "[var(--radix-popover-content-available-height)]",
  overflowY: "auto",
  rounded: "lg",
});

export const resultButton = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "0.5",
  width: "full",
  textAlign: "left",
  cursor: "pointer",
  border: "[none]",
  bg: "bg.secondary",
  p: "2",
  rounded: "sm",
});

const resultPath = css({
  textStyle: "label.sm.default",
  color: "text.lighter",
});

const statusText = css({
  display: "block",
  color: "text.lighter",
  p: "2",
});

/**
 * The interaction shell both organigram pickers share: one search-style input
 * that shows the suggested row as a clickable violet mark while it is empty,
 * opens a scrollable popover of ranked rows on focus, and switches that list
 * to whatever the consumer's `search` returns once the person types.
 *
 * It owns no domain knowledge -- which rows to rank, which corpus to search,
 * and what a pick means are all the consumer's. It owns the fiddly parts:
 * popover placement and dismissal, the clear-on-erase semantics, and the
 * scroll cap.
 */
export function OrganigramCombobox({
  label,
  placeholder,
  options,
  emptyPrompt,
  search,
  selectedLabel,
  hasValue,
  suggestionLabel,
  onAcceptSuggestion,
  onPick,
  onClear,
  footer,
}: OrganigramComboboxProps) {
  const id = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  // Distinguishes "never typed anything this time round" from "typed
  // something, then erased it back to empty" -- both leave `query` at "",
  // but only the second is a deliberate clear (see `closeWithoutPicking`).
  const [queryTouched, setQueryTouched] = useState(false);
  const [open, setOpen] = useState(false);

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  const searchResults = isSearching ? search.run(trimmedQuery) : [];

  // Hidden while the popover is open too -- the row is already in the list
  // right below, so the mark would be redundant clutter next to the search
  // box the person is actively using.
  const hasSuggestion = !open && !hasValue && !!suggestionLabel;

  function openForEditing() {
    setOpen(true);
    setQuery("");
    setQueryTouched(false);
  }

  function closeWithoutPicking(next: boolean) {
    // Closing on a deliberately-cleared, empty search un-sets the value --
    // matching how erasing a plain text field un-sets it, bringing its
    // suggestion mark back. Merely opening and closing again without typing
    // must NOT clear an existing value -- hence `queryTouched`, not `!query`.
    if (!next && queryTouched && query.trim() === "" && hasValue) {
      onClear();
    }
    setOpen(next);
    if (!next) {
      setQuery("");
      setQueryTouched(false);
    }
  }

  function pick(pickedId: string) {
    onPick(pickedId);
    setOpen(false);
    setQuery("");
  }

  function renderRow(option: OrganigramComboboxOption) {
    return (
      <styled.button
        key={option.id}
        type="button"
        className={resultButton}
        onClick={() => pick(option.id)}
      >
        <span>{option.name}</span>
        {/* A root's path is just its own name -- repeating it underneath
            reads as a glitch. */}
        {option.path && option.path !== option.name && (
          <span className={resultPath}>{option.path}</span>
        )}
      </styled.button>
    );
  }

  return (
    <Stack gap="1">
      {label && (
        <label className={labelStyle} htmlFor={id}>
          {label}
        </label>
      )}
      <Popover open={open} onOpenChange={closeWithoutPicking}>
        <PopoverAnchor asChild>
          <div
            ref={anchorRef}
            className={cx(inputBox, hasSuggestion && inputBoxWithSuggestion)}
          >
            <input
              id={id}
              role="combobox"
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-autocomplete="list"
              className={input}
              value={open ? query : (selectedLabel ?? "")}
              placeholder={placeholder}
              onFocus={openForEditing}
              onChange={(event) => {
                setOpen(true);
                setQuery(event.target.value);
                setQueryTouched(true);
              }}
            />
            {hasSuggestion && (
              <div className={suggestionSlot}>
                <Suggestion
                  as="button"
                  type="button"
                  clickable
                  className={suggestionButton}
                  onClick={onAcceptSuggestion}
                >
                  {suggestionLabel}
                </Suggestion>
              </div>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          // Radix only computes `--radix-popover-content-available-height`
          // (used by `resultList`) when it is free to flip/shrink, and
          // `collisionPadding` keeps the panel off the viewport edge so the
          // last row is never flush against it.
          collisionPadding={16}
          onOpenAutoFocus={(event) => event.preventDefault()}
          // `PopoverAnchor` (unlike `PopoverTrigger`) isn't exempted from
          // Radix's own outside-interaction dismissal -- opening on the
          // input's `onFocus` means the very pointerdown that focused it (and
          // triggered this same open) also reads as an "outside" interaction
          // to the popover that pointerdown just opened, closing it again on
          // the same tick. Ignore interactions that actually originate on our
          // own anchor -- they're the open, not a dismiss.
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) {
              event.preventDefault();
            }
          }}
        >
          <Stack gap="1" className={resultList}>
            {!isSearching && options.map(renderRow)}
            {!isSearching && options.length === 0 && (
              <span className={statusText}>{emptyPrompt}</span>
            )}

            {isSearching && searchResults.map(renderRow)}
            {isSearching && searchResults.length === 0 && search.isLoading && (
              <span className={statusText}>{search.loadingLabel}</span>
            )}
            {isSearching && searchResults.length === 0 && search.isError && (
              <span className={statusText}>{search.errorLabel}</span>
            )}

            {isSearching && footer?.(trimmedQuery, searchResults.length)}
          </Stack>
        </PopoverContent>
      </Popover>
    </Stack>
  );
}
