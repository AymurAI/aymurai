import { Select } from "@aymurai/ui";
import type { OrganigramCandidate } from "@/types/dataExtraction";

export interface RecipientUnitSelectValue {
  unit_id: string;
  sector_id: string | null;
}

export interface RecipientUnitSelectProps {
  /** `sector_candidates` for one recipient -- each entry is already a
   *  consistent (unit, sector) pair by construction, not the whole
   *  organigram. Built server-side by `_sector_candidates_from_units`,
   *  which sets `unit_id = sector_id = <the sector's own id>` for every
   *  candidate -- they represent sectors, not leaf units. */
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
   *  ids. Preselecting the backend's already-resolved candidate means
   *  matching on `sector_id`, not `unit_id` (see CES final-review finding:
   *  matching on `unit_id` alone left the selector always empty even when
   *  the backend had already resolved a sector). */
  sectorId: string | null;
  onChange: (value: RecipientUnitSelectValue) => void;
  label?: string;
}

export function RecipientUnitSelect({
  candidates,
  unitId,
  sectorId,
  onChange,
  label,
}: RecipientUnitSelectProps) {
  if (candidates.length === 0) return null;

  const options = candidates.map((candidate) => ({
    id: candidate.unit_id,
    text: candidate.unit_name,
    description: candidate.ruta_organigrama,
  }));

  const resolved = candidates.find(
    (candidate) => candidate.sector_id === sectorId,
  );
  const selectValue = resolved?.unit_id ?? unitId ?? undefined;

  return (
    <Select
      label={label}
      options={options}
      value={selectValue}
      onChange={(option) => {
        const picked = candidates.find(
          (candidate) => candidate.unit_id === option.id,
        );
        onChange({ unit_id: option.id, sector_id: picked?.sector_id ?? null });
      }}
    />
  );
}
