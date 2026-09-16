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
import { normalizeForSearch } from "@/utils/organigram/normalize-for-search";
import { resolveSector, unitPath } from "@/utils/organigram/resolve-sector";

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
  /** The backend's auto-resolution for this recipient, frozen at first render
   *  (`suggestions.recipients[i]`). This is the suggestion: it consults the
   *  learned index and applies a score threshold, and its two ids are
   *  consistent with each other by construction. The ranked `candidates` are
   *  alternatives, and only stand in when this came back empty. Shown as a
   *  clickable violet mark, same as `ValidatedTextField`, until `unitId` is
   *  set (accepting it, or picking anything else, both set it). `undefined`
   *  when there is nothing to suggest at all (a hand-added recipient, or
   *  nothing cleared the threshold). */
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
  const q = normalizeForSearch(needle);
  return (
    normalizeForSearch(unit.name).includes(q) ||
    normalizeForSearch(unit.acronym).includes(q) ||
    normalizeForSearch(unit.short_name).includes(q)
  );
}

/** One ranked row of this picker: a real organigram UNIT, unlike the
 *  `OrganigramCandidate` it comes from (which is a sector). */
interface UnitRow {
  unit_id: string;
  unit_name: string;
  /** The sector the backend already paired with this unit -- posting the two
   *  together is the pairing its consistency check is guaranteed to accept. */
  sector_id: string | null;
  path: string;
  score: number;
}

/**
 * Turns the ranked sectors the backend sends into the units they were
 * inferred from. Each candidate carries exactly one `source_unit` (the
 * best-scoring unit that resolved to that sector), which is what this field
 * is actually about: the unit the cargo points at.
 *
 * The row's path is computed from the corpus, because the candidate's own
 * `ruta_organigrama` is the SECTOR's path, not the unit's. It falls back to
 * that sector path while the corpus is still loading, so rows are never
 * blank.
 *
 * A candidate with no `source_unit_id` (an older backend) degrades to the
 * candidate itself rather than dropping out of the list.
 */
function candidateUnitRows(
  candidates: OrganigramCandidate[],
  corpus: OrganigramUnit[] | undefined,
): UnitRow[] {
  return candidates.map((candidate) => {
    const unitId = candidate.source_unit_id ?? candidate.unit_id;
    const unitName = candidate.source_unit_name ?? candidate.unit_name;
    const path = corpus ? unitPath(unitId, corpus) : "";
    return {
      unit_id: unitId,
      unit_name: unitName,
      sector_id: candidate.sector_id,
      path: path || candidate.ruta_organigrama,
      score: candidate.score,
    };
  });
}

/** Display name for a unit id. `RecipientFormValues` carries only ids (see
 *  `useRecommendationForm`'s `recipientFromPrediction`), so the name comes
 *  from the ranked rows when it is one of them, and from the fetched corpus
 *  otherwise -- e.g. a unit picked through the full-corpus search. */
function unitLabel(
  unitId: string | null,
  rows: UnitRow[],
  corpus: OrganigramUnit[] | undefined,
): string | null {
  if (!unitId) return null;
  const row = rows.find((candidate) => candidate.unit_id === unitId);
  if (row) return row.unit_name;
  return corpus?.find((unit) => unit.id === unitId)?.name ?? null;
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

  const rows = candidateUnitRows(candidates, unitsQuery.data);
  const selectedLabel = unitLabel(unitId, rows, unitsQuery.data);

  // The suggestion is the backend's own auto-resolution, not the top of the
  // ranked list. That resolution is the system's committed answer -- it
  // consults the learned index of what humans already validated, and applies
  // a score threshold, returning nothing rather than a bad guess. The ranking
  // has no threshold: `candidates[0]` exists whenever any unit does, however
  // poorly it scored. The two answer different questions, so the committed
  // one wins and the ranking stays what it is, a list of alternatives.
  //
  // Only when the auto-resolve came back empty (nothing cleared the
  // threshold) does the best-scoring row stand in as a starting point.
  const topRow = rows.reduce<UnitRow | undefined>(
    (best, row) => (!best || row.score > best.score ? row : best),
    undefined,
  );
  const suggestedUnitId = suggestion?.unit_id ?? topRow?.unit_id ?? null;
  const suggestedSectorId = suggestion?.unit_id
    ? suggestion.sector_id
    : (topRow?.sector_id ?? null);
  // Only meaningful while nothing is chosen yet -- once `unitId` is set
  // (accepting this same suggestion, or picking anything else), the mark
  // must disappear just like `ValidatedTextField`'s.
  const suggestedLabel = unitId
    ? null
    : unitLabel(suggestedUnitId, rows, unitsQuery.data);
  // Hidden while the popover is open too -- it already shows in the list
  // right below, so the mark would be redundant clutter next to the search
  // box the person is actively using.
  const hasSuggestion = !open && !!suggestedLabel;

  function acceptSuggestion() {
    if (!suggestedUnitId) return;
    onChange({ unit_id: suggestedUnitId, sector_id: suggestedSectorId });
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

  /** The sector a unit belongs to, walked over the corpus exactly as the
   *  server walks it. Used for picks the backend never paired for us -- a
   *  full-corpus search hit, or a unit created on the spot -- which until now
   *  posted `sector_id: null` and blanked SECTOR_FINAL in the export. */
  function sectorFor(pickedUnitId: string): string | null {
    return resolveSector(pickedUnitId, unitsQuery.data ?? [])?.id ?? null;
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
          // Radix only computes `--radix-popover-content-available-height`
          // (used by `resultList` below) when it is free to flip/shrink, and
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
            {!isSearching &&
              rows.map((row) => (
                <styled.button
                  key={row.unit_id}
                  type="button"
                  className={resultButton}
                  onClick={() => pick(row.unit_id, row.sector_id)}
                >
                  <span>{row.unit_name}</span>
                  {/* A root unit's path is just its own name -- repeating it
                      underneath reads as a glitch. */}
                  {row.path !== row.unit_name && (
                    <span className={resultPath}>{row.path}</span>
                  )}
                </styled.button>
              ))}
            {!isSearching && rows.length === 0 && (
              <span className={statusText}>
                Escribí para buscar una unidad del organigrama…
              </span>
            )}

            {isSearching &&
              searchResults.map((unit) => (
                <styled.button
                  key={unit.id}
                  type="button"
                  className={resultButton}
                  onClick={() => pick(unit.id, sectorFor(unit.id))}
                >
                  <span>{unit.name}</span>
                  {/* The organigram has homonymous units (several DGTALs, see
                      ADR-0002) -- without the path they are indistinguishable
                      in a flat search. Skipped for a root, whose path is just
                      its own name. */}
                  {unitPath(unit.id, unitsQuery.data ?? []) !== unit.name && (
                    <span className={resultPath}>
                      {unitPath(unit.id, unitsQuery.data ?? [])}
                    </span>
                  )}
                </styled.button>
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
                        // Created as a root (`parent_id: null`), so it has no
                        // sector to resolve yet -- `sectorFor` returns null
                        // here by construction, and stays honest if that
                        // changes and the unit is created somewhere in the
                        // tree.
                        pick(unit.id, sectorFor(unit.id));
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
