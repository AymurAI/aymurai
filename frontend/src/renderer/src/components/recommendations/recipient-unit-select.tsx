import { Search, Select } from "@aymurai/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createUnit, listUnits } from "@/services/aymurai/organigram";
import { css } from "@/styled/css";
import { Stack } from "@/styled/jsx";
import type { OrganigramCandidate } from "@/types/dataExtraction";
import type { OrganigramUnit } from "@/types/organigram";

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

const searchResultButton = css({
  display: "block",
  width: "full",
  textAlign: "left",
  cursor: "pointer",
  border: "[none]",
  bg: "bg.secondary",
  p: "2",
  rounded: "sm",
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

export function RecipientUnitSelect({
  candidates,
  unitId,
  sectorId,
  onChange,
  label,
}: RecipientUnitSelectProps) {
  const [query, setQuery] = useState("");
  const unitsQuery = useQuery(listUnits());
  const createUnitMutation = useMutation(createUnit());

  const options = candidates.map((candidate) => ({
    id: candidate.unit_id,
    text: candidate.unit_name,
    description: candidate.ruta_organigrama,
  }));

  const resolved = candidates.find(
    (candidate) => candidate.sector_id === sectorId,
  );
  const selectValue = resolved?.unit_id ?? unitId ?? undefined;

  const trimmedQuery = query.trim();
  const searchResults =
    trimmedQuery.length > 0
      ? (unitsQuery.data ?? []).filter((unit) =>
          matchesQuery(unit, trimmedQuery),
        )
      : [];
  // `unitsQuery.data` is `undefined` both while the corpus is still loading
  // and after a failed fetch, which would otherwise make `searchResults`
  // resolve to `[]` indistinguishably from "confirmed zero matches across
  // the whole organigram" -- offering to create a unit in either case risks
  // creating a duplicate `OrganigramUnit` row for something that already
  // exists in the not-yet-loaded/failed corpus. Only offer "create" once the
  // corpus has actually loaded successfully.
  const canOfferCreate = trimmedQuery.length > 0 && unitsQuery.isSuccess;

  return (
    <Stack gap="2">
      {candidates.length > 0 && (
        <Select
          label={label}
          options={options}
          value={selectValue}
          onChange={(option) => {
            const picked = candidates.find(
              (candidate) => candidate.unit_id === option.id,
            );
            onChange({
              unit_id: option.id,
              sector_id: picked?.sector_id ?? null,
            });
          }}
        />
      )}

      <Search
        value={query}
        aria-label="Buscar otra unidad del organigrama"
        placeholder="Buscar otra unidad del organigrama…"
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery("")}
      />

      {trimmedQuery.length > 0 && (
        <Stack gap="1">
          {searchResults.map((unit) => (
            <button
              key={unit.id}
              type="button"
              className={searchResultButton}
              onClick={() => {
                onChange({ unit_id: unit.id, sector_id: null });
                setQuery("");
              }}
            >
              {unit.name}
            </button>
          ))}
          {searchResults.length === 0 && unitsQuery.isLoading && (
            <span className={statusText}>Buscando en el organigrama…</span>
          )}
          {searchResults.length === 0 && unitsQuery.isError && (
            <span className={statusText}>
              No se pudo cargar el organigrama para buscar. Reintentá más tarde.
            </span>
          )}
          {searchResults.length === 0 && canOfferCreate && (
            <button
              type="button"
              className={searchResultButton}
              disabled={createUnitMutation.isPending}
              onClick={() => {
                createUnitMutation.mutate(
                  { parent_id: null, name: trimmedQuery, is_sector: false },
                  {
                    onSuccess: (unit) => {
                      onChange({ unit_id: unit.id, sector_id: null });
                      setQuery("");
                    },
                  },
                );
              }}
            >
              Crear "{trimmedQuery}" como nueva unidad
            </button>
          )}
        </Stack>
      )}
    </Stack>
  );
}
