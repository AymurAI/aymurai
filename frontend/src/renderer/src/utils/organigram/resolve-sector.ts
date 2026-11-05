import type { OrganigramUnit } from "@/types/organigram";

/**
 * Client-side mirror of the backend's organigram tree rules
 * (`aymurai/database/crud/organigram/sector.py`), over the flat corpus
 * `listUnits()` already keeps in memory -- every row carries `parent_id` and
 * `is_sector`, so none of this needs a round trip.
 *
 * The sector of a unit is the deepest ancestor-OR-SELF with `is_sector`
 * (ADR-0001): the 33 sectors are real nodes of the tree, not a separate
 * catalog, and they sit at three different depths, so no depth rule works.
 * An autonomous body (IVC, AGC, AGIP, COPIDIS) is its own sector even though
 * it hangs off a ministry that is also one -- which is why "self" comes
 * before "ancestor" here.
 */

/** Walking a cycle would hang the renderer. The real tree is depth 7; this is
 *  a guard against corrupt data, not a real limit. */
const MAX_DEPTH = 64;

function byId(corpus: OrganigramUnit[]): Map<string, OrganigramUnit> {
  return new Map(corpus.map((unit) => [unit.id, unit]));
}

/** Root-to-self chain, self last. Empty when `unitId` is not in the corpus. */
function chain(
  unitId: string | null,
  index: Map<string, OrganigramUnit>,
): OrganigramUnit[] {
  const path: OrganigramUnit[] = [];
  let current = unitId ? index.get(unitId) : undefined;
  while (current && path.length < MAX_DEPTH) {
    path.unshift(current);
    current = current.parent_id ? index.get(current.parent_id) : undefined;
  }
  return path;
}

/**
 * The deepest ancestor-or-self with `is_sector && active` -- the backend
 * requires both, so a deactivated sector stops resolving as one.
 */
export function resolveSector(
  unitId: string | null,
  corpus: OrganigramUnit[],
): OrganigramUnit | null {
  const path = chain(unitId, byId(corpus));
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const unit = path[i];
    if (unit.is_sector && unit.active) return unit;
  }
  return null;
}

/**
 * Whether `sectorId` is the sector `unitId` actually belongs to. Mirrors the
 * server's consistency check, which is what returns 422 on a mismatched pair
 * (ADR-0009) -- so this is the same question, asked before the round trip.
 *
 * Unlike `resolveSector` this ignores `active` on purpose, matching
 * `is_sector_ancestor_of`: deactivating a sector must not retroactively
 * invalidate a pair a human already validated under it.
 */
export function isSectorAncestorOf(
  sectorId: string | null,
  unitId: string | null,
  corpus: OrganigramUnit[],
): boolean {
  if (!sectorId || !unitId) return false;
  const index = byId(corpus);
  const path = chain(unitId, index);
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const unit = path[i];
    if (!unit.is_sector) continue;
    // The first sector found walking up IS the unit's sector; anything above
    // it is a container of that sector, not of the unit.
    return unit.id === sectorId;
  }
  return false;
}

/**
 * Active units whose resolved sector is `sectorId` -- the scope the unit
 * picker narrows to once someone validates a sector by hand.
 */
export function unitsInSector(
  sectorId: string | null,
  corpus: OrganigramUnit[],
): OrganigramUnit[] {
  if (!sectorId) return [];
  return corpus.filter(
    (unit) => unit.active && resolveSector(unit.id, corpus)?.id === sectorId,
  );
}

/** Root-to-self names joined the same way the backend builds
 *  `ruta_organigrama`. Empty string when the unit is not in the corpus. */
export function unitPath(
  unitId: string | null,
  corpus: OrganigramUnit[],
): string {
  return chain(unitId, byId(corpus))
    .map((unit) => unit.name)
    .join(" > ");
}
