import { Callout } from "@aymurai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createUnit, listUnits } from "@/services/aymurai/organigram";
import type { OrganigramCandidate } from "@/types/dataExtraction";
import type { OrganigramUnit } from "@/types/organigram";
import { normalizeForSearch } from "@/utils/organigram/normalize-for-search";
import {
  resolveSector,
  unitPath,
  unitsInSector,
} from "@/utils/organigram/resolve-sector";
import {
  OrganigramCombobox,
  type OrganigramComboboxOption,
  resultButton,
} from "./organigram-combobox";

export interface RecipientUnitComboboxValue {
  /** `null` clears the field -- emitted when the person types a search,
   *  then erases it back to empty without picking anything, matching how
   *  clearing a plain text field (`ValidatedTextField`) un-sets its value
   *  and brings the suggestion mark back. */
  unit_id: string | null;
  sector_id: string | null;
}

export interface RecipientUnitComboboxProps {
  /** `sector_candidates` for one recipient. Each row IS a sector (ADR-0008),
   *  so the unit this field is about travels in `source_unit_id` -- see
   *  `candidateUnitRows`. */
  candidates: OrganigramCandidate[];
  /** The recipient's current `unit_id`. */
  unitId: string | null;
  /** The backend's auto-resolution for this recipient, frozen at first render
   *  (`suggestions.recipients[i]`). This is the suggestion: it consults the
   *  learned index and applies a score threshold, and its two ids are
   *  consistent with each other by construction. The ranked `candidates` are
   *  alternatives, and only stand in when this came back empty. `undefined`
   *  when there is nothing to suggest at all (a hand-added recipient, or
   *  nothing cleared the threshold). */
  suggestion?: { unit_id: string | null; sector_id: string | null };
  /** When set, the person validated this sector by hand and the unit does not
   *  belong to it: both the ranked rows and the search narrow to that
   *  sector's units until the pair agrees again. */
  restrictToSectorId?: string | null;
  onChange: (value: RecipientUnitComboboxValue) => void;
  label?: string;
}

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
interface UnitRow extends OrganigramComboboxOption {
  /** The sector the backend already paired with this unit -- posting the two
   *  together is the pairing its consistency check is guaranteed to accept. */
  sector_id: string | null;
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
    const path = corpus ? unitPath(unitId, corpus) : "";
    return {
      id: unitId,
      name: candidate.source_unit_name ?? candidate.unit_name,
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
  const row = rows.find((candidate) => candidate.id === unitId);
  if (row) return row.name;
  return corpus?.find((unit) => unit.id === unitId)?.name ?? null;
}

/**
 * The organigram unit a recipient's cargo points at. Ranked rows come from
 * the candidates' `source_unit`; typing searches the whole organigram (or a
 * single sector, when one was pinned by hand), and a miss offers to create
 * the unit.
 */
export function RecipientUnitCombobox({
  candidates,
  unitId,
  suggestion,
  restrictToSectorId,
  onChange,
  label,
}: RecipientUnitComboboxProps) {
  const [createUnitFailed, setCreateUnitFailed] = useState(false);
  const queryClient = useQueryClient();
  const unitsQuery = useQuery(listUnits());
  const createUnitMutation = useMutation(createUnit());

  const corpus = unitsQuery.data;
  const restricted = restrictToSectorId
    ? unitsInSector(restrictToSectorId, corpus ?? [])
    : null;

  const rankedRows = candidateUnitRows(candidates, corpus);
  // While a sector is pinned, the cargo's candidates are the wrong offer --
  // they are exactly the units that do NOT belong to it. Offer that sector's
  // own units instead.
  const rows: UnitRow[] = restricted
    ? restricted.map((unit) => ({
        id: unit.id,
        name: unit.name,
        path: unitPath(unit.id, corpus ?? []),
        sector_id: restrictToSectorId ?? null,
        score: 0,
      }))
    : rankedRows;

  const selectedLabel = unitLabel(unitId, rankedRows, corpus);

  // The suggestion is the backend's own auto-resolution, not the top of the
  // ranked list. That resolution is the system's committed answer -- it
  // consults the learned index of what humans already validated, and applies
  // a score threshold, returning nothing rather than a bad guess. The ranking
  // has no threshold: `candidates[0]` exists whenever any unit does, however
  // poorly it scored. The two answer different questions, so the committed
  // one wins and the ranking stays what it is, a list of alternatives.
  //
  // Only when the auto-resolve came back empty does the best-scoring row
  // stand in as a starting point.
  const topRow = rankedRows.reduce<UnitRow | undefined>(
    (best, row) => (!best || row.score > best.score ? row : best),
    undefined,
  );
  const suggestedUnitId = suggestion?.unit_id ?? topRow?.id ?? null;
  const suggestedSectorId = suggestion?.unit_id
    ? suggestion.sector_id
    : (topRow?.sector_id ?? null);

  /** The sector a unit belongs to, walked over the corpus exactly as the
   *  server walks it. Used for picks the backend never paired for us -- a
   *  search hit, or a unit created on the spot -- which until now posted
   *  `sector_id: null` and blanked SECTOR_FINAL in the export. */
  function sectorFor(pickedUnitId: string): string | null {
    return resolveSector(pickedUnitId, corpus ?? [])?.id ?? null;
  }

  function pick(pickedUnitId: string) {
    // A ranked row already carries the pairing the backend derived; anything
    // else is resolved the same way the server would.
    const ranked = rows.find((row) => row.id === pickedUnitId);
    onChange({
      unit_id: pickedUnitId,
      sector_id: ranked ? ranked.sector_id : sectorFor(pickedUnitId),
    });
  }

  return (
    <OrganigramCombobox
      label={label}
      placeholder="Buscar unidad del organigrama…"
      options={rows}
      emptyPrompt={
        restricted
          ? "Este sector no tiene unidades activas."
          : "Escribí para buscar una unidad del organigrama…"
      }
      search={{
        run: (query) =>
          (restricted ?? corpus ?? [])
            .filter((unit) => matchesQuery(unit, query))
            .map((unit) => ({
              id: unit.id,
              name: unit.name,
              // The organigram has homonymous units (several DGTALs, see
              // ADR-0002) -- without the path they are indistinguishable in
              // a flat search.
              path: unitPath(unit.id, corpus ?? []),
            })),
        isLoading: unitsQuery.isLoading,
        isError: unitsQuery.isError,
        loadingLabel: "Buscando en el organigrama…",
        errorLabel:
          "No se pudo cargar el organigrama para buscar. Reintentá más tarde.",
      }}
      selectedLabel={selectedLabel}
      hasValue={!!unitId}
      suggestionLabel={unitLabel(suggestedUnitId, rankedRows, corpus)}
      onAcceptSuggestion={() => {
        if (!suggestedUnitId) return;
        onChange({ unit_id: suggestedUnitId, sector_id: suggestedSectorId });
      }}
      onPick={pick}
      onClear={() => onChange({ unit_id: null, sector_id: null })}
      footer={(query, resultCount) => {
        // `unitsQuery.data` is `undefined` both while loading and after a
        // failed fetch, so only offer "create" once the corpus has actually
        // loaded successfully -- otherwise this risks creating a duplicate
        // row for something already in the not-yet-loaded corpus. Never
        // offered while a sector is pinned: the new unit would land outside
        // it and re-break the pair.
        const canOfferCreate =
          resultCount === 0 && unitsQuery.isSuccess && !restricted;
        return (
          <>
            {canOfferCreate && (
              <button
                type="button"
                className={resultButton}
                disabled={createUnitMutation.isPending}
                onClick={() => {
                  setCreateUnitFailed(false);
                  createUnitMutation.mutate(
                    { parent_id: null, name: query, is_sector: false },
                    {
                      onSuccess: (unit) => {
                        // Without invalidating, searching the same text again
                        // within this mounted instance still sees the stale
                        // (pre-creation) corpus -- matches
                        // unit-create-dialog.tsx's invalidation of the same
                        // query on a successful create.
                        queryClient.invalidateQueries({
                          queryKey: listUnits().queryKey,
                        });
                        // Created as a root (`parent_id: null`), so it has no
                        // sector to resolve yet -- null by construction here,
                        // and still honest if that ever changes.
                        onChange({
                          unit_id: unit.id,
                          sector_id: sectorFor(unit.id),
                        });
                      },
                      onError: () => setCreateUnitFailed(true),
                    },
                  );
                }}
              >
                Crear "{query}" como nueva unidad
              </button>
            )}
            {createUnitFailed && (
              <Callout
                message="No se pudo crear la unidad. Revisá tu conexión e intentá de nuevo."
                variant="error"
                role="alert"
              />
            )}
          </>
        );
      }}
    />
  );
}
