import { useQuery } from "@tanstack/react-query";
import { listUnits } from "@/services/aymurai/organigram";
import type { OrganigramCandidate } from "@/types/dataExtraction";
import type { OrganigramUnit } from "@/types/organigram";
import { normalizeForSearch } from "@/utils/organigram/normalize-for-search";
import { unitPath } from "@/utils/organigram/resolve-sector";
import {
  OrganigramCombobox,
  type OrganigramComboboxOption,
} from "./organigram-combobox";

export interface RecipientSectorComboboxProps {
  /** `sector_candidates` for one recipient. Every row already IS a sector
   *  (ADR-0008), so this picker uses them as they come -- unlike the unit
   *  picker, which has to dig out each row's `source_unit`. */
  candidates: OrganigramCandidate[];
  /** The recipient's current `sector_id`. */
  sectorId: string | null;
  /** The backend's auto-resolution, frozen at first render. Same reasoning as
   *  the unit picker's: it is the committed answer, the ranking is the list
   *  of alternatives. */
  suggestedSectorId?: string | null;
  onChange: (sectorId: string | null) => void;
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

function candidateSectorRows(
  candidates: OrganigramCandidate[],
): OrganigramComboboxOption[] {
  return candidates
    .filter((candidate) => candidate.sector_id !== null)
    .map((candidate) => ({
      id: candidate.sector_id as string,
      name: candidate.sector_name ?? candidate.unit_name,
      // Here the candidate's own path IS the right one: it is the sector's.
      path: candidate.ruta_organigrama,
    }));
}

function sectorLabel(
  sectorId: string | null,
  rows: OrganigramComboboxOption[],
  corpus: OrganigramUnit[] | undefined,
): string | null {
  if (!sectorId) return null;
  const row = rows.find((candidate) => candidate.id === sectorId);
  if (row) return row.name;
  return corpus?.find((unit) => unit.id === sectorId)?.name ?? null;
}

/**
 * The sector that contains the recipient's unit -- what the Defensoría calls
 * the "destinatario por sector", and what the export writes as SECTOR_FINAL.
 *
 * Normally it just follows the unit: picking a unit derives this. It stays
 * editable because a human validates the sector in its own right (ADR-0009),
 * and the server accepts it as an independent field rather than deriving it.
 * Only sectors are offered -- searching spans `is_sector` units alone.
 */
export function RecipientSectorCombobox({
  candidates,
  sectorId,
  suggestedSectorId,
  onChange,
  label,
}: RecipientSectorComboboxProps) {
  const unitsQuery = useQuery(listUnits());
  const corpus = unitsQuery.data;

  const rows = candidateSectorRows(candidates);
  const sectors = (corpus ?? []).filter(
    (unit) => unit.is_sector && unit.active,
  );

  return (
    <OrganigramCombobox
      label={label}
      placeholder="Buscar sector del organigrama…"
      options={rows}
      emptyPrompt="Escribí para buscar un sector del organigrama…"
      search={{
        run: (query) =>
          sectors
            .filter((unit) => matchesQuery(unit, query))
            .map((unit) => ({
              id: unit.id,
              name: unit.name,
              path: unitPath(unit.id, corpus ?? []),
            })),
        isLoading: unitsQuery.isLoading,
        isError: unitsQuery.isError,
        loadingLabel: "Buscando en el organigrama…",
        errorLabel:
          "No se pudo cargar el organigrama para buscar. Reintentá más tarde.",
      }}
      selectedLabel={sectorLabel(sectorId, rows, corpus)}
      hasValue={!!sectorId}
      suggestionLabel={sectorLabel(suggestedSectorId ?? null, rows, corpus)}
      onAcceptSuggestion={() => {
        if (!suggestedSectorId) return;
        onChange(suggestedSectorId);
      }}
      onPick={onChange}
      onClear={() => onChange(null)}
    />
  );
}
