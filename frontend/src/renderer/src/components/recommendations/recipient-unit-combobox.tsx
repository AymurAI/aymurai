import {
  Callout,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Suggestion,
} from "@aymurai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { createUnit, listUnits } from "@/services/aymurai/organigram";
import { css, cx } from "@/styled/css";
import { Stack, styled } from "@/styled/jsx";
import type { OrganigramCandidate } from "@/types/dataExtraction";
import type { OrganigramUnit } from "@/types/organigram";

export interface RecipientUnitComboboxValue {
  /** `null` clears the field -- emitted when the person types a search,
   *  then erases it back to empty without picking anything, matching how
   *  clearing a plain text field (`ValidatedTextField`) un-sets its value
   *  and brings the suggestion mark back. */
  unit_id: string | null;
  sector_id: string | null;
}

export interface RecipientUnitComboboxProps {
  /** `sector_candidates` for one recipient -- each entry is already a
   *  consistent (unit, sector) pair by construction, not the whole
   *  organigram. Built server-side by `_sector_candidates_from_units`. Not
   *  every row is sector-level (`unit_id = sector_id = <the sector's own
   *  id>`) -- a strong leaf-unit match can rank alongside its own ancestor
   *  sector as two distinct rows, so don't assume `sector_id` alone
   *  disambiguates a row (see `resolveCandidate`'s doc). */
  candidates: OrganigramCandidate[];
  /** The recipient's current `unit_id`. Only ever matches a candidate here
   *  when the person already picked one FROM this list (`onChange` below
   *  always sets `unit_id`/`sector_id` to the same candidate id, by
   *  construction) -- kept as a fallback for that case. */
  unitId: string | null;
  /** The recipient's current `sector_id`. This is what the backend's
   *  automatic resolution actually sets consistently: it resolves `unit_id`
   *  to a leaf unit (never one of these sector candidates) and `sector_id`
   *  to that leaf's ancestor sector -- which IS one of these candidates'
   *  ids. */
  sectorId: string | null;
  /** The backend's own coarser auto-resolution for this recipient, frozen at
   *  first render (`suggestions.recipients[i]`) -- used as the suggestion
   *  ONLY when `candidates` is empty (nothing to rank). Whenever `candidates`
   *  is non-empty, its own highest-scored entry is the suggestion instead
   *  (a finer-grained, per-unit ranking that can legitimately disagree with
   *  this coarser field -- see `topCandidate`'s doc). Shown as a clickable
   *  violet mark, same as `ValidatedTextField`, until `unitId` is set
   *  (accepting the suggestion, or picking anything else, both set it).
   *  `undefined` when there is nothing to suggest at all (a hand-added
   *  recipient, or the backend found no match). */
  suggestion?: { unit_id: string | null; sector_id: string | null };
  onChange: (value: RecipientUnitComboboxValue) => void;
  label?: string;
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

const resultButton = css({
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

function matchesQuery(unit: OrganigramUnit, needle: string): boolean {
  const q = needle.toLowerCase();
  return (
    unit.name.toLowerCase().includes(q) ||
    (unit.acronym ?? "").toLowerCase().includes(q) ||
    (unit.short_name ?? "").toLowerCase().includes(q)
  );
}

/** Finds the `candidates` entry (if any) an (unitId, sectorId) pair refers
 *  to. Tries an exact `unit_id` match FIRST: in practice `candidates` mixes
 *  leaf-unit rows (their own `unit_id`, ranked on their own merit -- e.g. a
 *  strong text match on the office itself) with sector-level rows (per
 *  `_sector_candidates_from_units`, `unit_id = sector_id = <the sector's own
 *  id>`), and a leaf's own ancestor sector is often ALSO a separate
 *  candidate row -- so matching by `sector_id` alone is ambiguous between
 *  the two and would silently prefer the coarser (sector) row over the more
 *  precise (leaf) one it was ranked alongside. `sector_id` is only a
 *  fallback for when the leaf itself never made it into `candidates`. */
function resolveCandidate(
  ids: { unitId: string | null; sectorId: string | null },
  candidates: OrganigramCandidate[],
): OrganigramCandidate | undefined {
  const byUnit =
    ids.unitId &&
    candidates.find((candidate) => candidate.unit_id === ids.unitId);
  return (
    byUnit ||
    candidates.find((candidate) => candidate.sector_id === ids.sectorId)
  );
}

/** Resolves a display name for an (unitId, sectorId) pair -- neither
 *  `RecipientFormValues` nor its frozen `suggestion` carry a name, only ids
 *  (see `useRecommendationForm.ts`'s `recipientFromDetail`/
 *  `recipientFromPrediction`). Falls back to the already-fetched
 *  `listUnits()` corpus by `unitId` for a unit outside `candidates`
 *  entirely -- e.g. one picked via search. */
function resolveLabel(
  ids: { unitId: string | null; sectorId: string | null },
  candidates: OrganigramCandidate[],
  corpus: OrganigramUnit[] | undefined,
): string | null {
  const candidate = resolveCandidate(ids, candidates);
  if (candidate) return candidate.unit_name;
  if (!ids.unitId) return null;
  return corpus?.find((unit) => unit.id === ids.unitId)?.name ?? null;
}

/**
 * A single search-style input that merges what used to be three separate
 * affordances (the model's suggestion, a ranked `Select` of `candidates`,
 * and a free-text `Search` across the whole organigram) into one combobox:
 * closed with nothing chosen yet, it shows the suggested unit (if any) as a
 * clickable violet mark, same as `ValidatedTextField`; focusing it opens a
 * popover listing `candidates` -- no separate "Sugerido" tag in there, since
 * the suggestion is already the first (highest-scored) row and the mark
 * above already names it, so tagging it again in the list would be
 * redundant; typing switches that list to a full-corpus search, same as the
 * old `Search` half, including the create-unit affordance.
 */
export function RecipientUnitCombobox({
  candidates,
  unitId,
  sectorId,
  suggestion,
  onChange,
  label,
}: RecipientUnitComboboxProps) {
  const id = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  // Distinguishes "never typed anything this time round" from "typed
  // something, then erased it back to empty" -- both leave `query` at "",
  // but only the second is a deliberate clear (see `closeWithoutPicking`).
  const [queryTouched, setQueryTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [createUnitFailed, setCreateUnitFailed] = useState(false);
  const queryClient = useQueryClient();
  const unitsQuery = useQuery(listUnits());
  const createUnitMutation = useMutation(createUnit());

  const selectedLabel = resolveLabel(
    { unitId, sectorId },
    candidates,
    unitsQuery.data,
  );
  // The highest-scored `candidates` row IS the suggestion whenever there are
  // any -- `sector_candidates`' own ranking is a finer-grained, per-unit
  // signal than `suggestion`'s `unit_id`/`sector_id` (the backend's separate,
  // coarser auto-resolution), and the two can legitimately disagree: a
  // specific office can rank #1 here while that coarser resolution only
  // committed to its parent sector. Trusting the ranking over the frozen
  // suggestion is what actually matches "the top-ranked candidate" people
  // see in the list. `suggestion` itself is only a fallback for when there
  // is nothing to rank at all.
  const topCandidate = candidates.reduce<OrganigramCandidate | undefined>(
    (best, candidate) =>
      !best || candidate.score > best.score ? candidate : best,
    undefined,
  );
  const suggestedCandidate =
    topCandidate ??
    (suggestion?.unit_id
      ? resolveCandidate(
          { unitId: suggestion.unit_id, sectorId: suggestion.sector_id },
          candidates,
        )
      : undefined);
  // Only meaningful while nothing is chosen yet -- once `unitId` is set
  // (accepting this same suggestion, or picking anything else), the mark
  // must disappear just like `ValidatedTextField`'s.
  const suggestedLabel = unitId
    ? null
    : (suggestedCandidate?.unit_name ??
      (suggestion?.unit_id
        ? (unitsQuery.data?.find((unit) => unit.id === suggestion.unit_id)
            ?.name ?? null)
        : null));
  // Hidden while the popover is open too -- it already shows first
  // (highest-scored) in the list right below, so the mark would be
  // redundant clutter next to the search box the person is actively using.
  const hasSuggestion = !open && !!suggestedLabel;

  function acceptSuggestion() {
    if (suggestedCandidate) {
      onChange({
        unit_id: suggestedCandidate.unit_id,
        sector_id: suggestedCandidate.sector_id,
      });
      return;
    }
    if (!suggestion?.unit_id) return;
    onChange({ unit_id: suggestion.unit_id, sector_id: suggestion.sector_id });
  }

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  const searchResults = isSearching
    ? (unitsQuery.data ?? []).filter((unit) => matchesQuery(unit, trimmedQuery))
    : [];
  // Same reasoning as the old `Search` half: `unitsQuery.data` is
  // `undefined` both while loading and after a failed fetch, so only offer
  // "create" once the corpus has actually loaded successfully -- otherwise
  // this risks creating a duplicate row for something already in the
  // not-yet-loaded/failed corpus.
  const canOfferCreate = isSearching && unitsQuery.isSuccess;

  function openForEditing() {
    setOpen(true);
    setQuery("");
    setQueryTouched(false);
  }

  function closeWithoutPicking(next: boolean) {
    // Closing on a deliberately-cleared, empty search un-sets the value --
    // matching how erasing a plain text field un-sets it, bringing its
    // suggestion mark back (see `RecipientUnitComboboxValue.unit_id`'s doc).
    // Merely opening and closing again without typing anything must NOT
    // clear an existing value -- hence `queryTouched`, not just `!query`.
    if (!next && queryTouched && query.trim() === "" && unitId) {
      onChange({ unit_id: null, sector_id: null });
    }
    setOpen(next);
    if (!next) {
      setQuery("");
      setQueryTouched(false);
    }
  }

  function pick(pickedUnitId: string, pickedSectorId: string | null) {
    onChange({ unit_id: pickedUnitId, sector_id: pickedSectorId });
    setOpen(false);
    setQuery("");
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
              placeholder="Buscar unidad del organigrama…"
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
                  onClick={acceptSuggestion}
                >
                  {suggestedLabel}
                </Suggestion>
              </div>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
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
          <Stack gap="1">
            {!isSearching &&
              candidates.map((candidate) => (
                <styled.button
                  key={candidate.unit_id}
                  type="button"
                  className={resultButton}
                  onClick={() => pick(candidate.unit_id, candidate.sector_id)}
                >
                  <span>{candidate.unit_name}</span>
                  <span className={resultPath}>
                    {candidate.ruta_organigrama}
                  </span>
                </styled.button>
              ))}
            {!isSearching && candidates.length === 0 && (
              <span className={statusText}>
                Escribí para buscar una unidad del organigrama…
              </span>
            )}

            {isSearching &&
              searchResults.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  className={resultButton}
                  onClick={() => pick(unit.id, null)}
                >
                  {unit.name}
                </button>
              ))}
            {isSearching &&
              searchResults.length === 0 &&
              unitsQuery.isLoading && (
                <span className={statusText}>Buscando en el organigrama…</span>
              )}
            {isSearching &&
              searchResults.length === 0 &&
              unitsQuery.isError && (
                <span className={statusText}>
                  No se pudo cargar el organigrama para buscar. Reintentá más
                  tarde.
                </span>
              )}
            {isSearching && searchResults.length === 0 && canOfferCreate && (
              <button
                type="button"
                className={resultButton}
                disabled={createUnitMutation.isPending}
                onClick={() => {
                  setCreateUnitFailed(false);
                  createUnitMutation.mutate(
                    { parent_id: null, name: trimmedQuery, is_sector: false },
                    {
                      onSuccess: (unit) => {
                        // Without invalidating, searching the same text
                        // again within this mounted instance still sees the
                        // stale (pre-creation) corpus -- matches
                        // unit-create-dialog.tsx's invalidation of the same
                        // query on a successful create.
                        queryClient.invalidateQueries({
                          queryKey: listUnits().queryKey,
                        });
                        pick(unit.id, null);
                      },
                      onError: () => {
                        setCreateUnitFailed(true);
                      },
                    },
                  );
                }}
              >
                Crear "{trimmedQuery}" como nueva unidad
              </button>
            )}
            {createUnitFailed && (
              <Callout
                message="No se pudo crear la unidad. Revisá tu conexión e intentá de nuevo."
                variant="error"
                role="alert"
              />
            )}
          </Stack>
        </PopoverContent>
      </Popover>
    </Stack>
  );
}
