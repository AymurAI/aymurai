import { Select } from "@aymurai/ui";
import type { OrganigramCandidate } from "@/types/dataExtraction";

export interface RecipientUnitSelectValue {
  unit_id: string;
  sector_id: string | null;
}

export interface RecipientUnitSelectProps {
  /** `sector_candidates` for one recipient -- each entry is already a
   *  consistent (unit, sector) pair by construction, not the whole
   *  organigram. */
  candidates: OrganigramCandidate[];
  value: string | null;
  onChange: (value: RecipientUnitSelectValue) => void;
  label?: string;
}

export function RecipientUnitSelect({
  candidates,
  value,
  onChange,
  label,
}: RecipientUnitSelectProps) {
  if (candidates.length === 0) return null;

  const options = candidates.map((candidate) => ({
    id: candidate.unit_id,
    text: candidate.unit_name,
    description: candidate.ruta_organigrama,
  }));

  return (
    <Select
      label={label}
      options={options}
      value={value ?? undefined}
      onChange={(option) => {
        const picked = candidates.find(
          (candidate) => candidate.unit_id === option.id,
        );
        onChange({ unit_id: option.id, sector_id: picked?.sector_id ?? null });
      }}
    />
  );
}
