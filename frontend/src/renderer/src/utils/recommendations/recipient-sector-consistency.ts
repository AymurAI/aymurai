import { GCBA_MACRO_SECTOR_CODE } from "@/types/catalogs";
import type { OrganigramUnit } from "@/types/organigram";
import { isSectorAncestorOf } from "@/utils/organigram/resolve-sector";

/** The fields the rule reads -- satisfied by both `RecipientFormValues` and
 *  the `RecipientValidationInput` that goes on the wire. */
export interface RecipientSectorPair {
  macro_sector: string | null;
  unit_id: string | null;
  sector_id: string | null;
}

/**
 * Whether this recipient's validated sector contradicts its unit.
 *
 * The server refuses the pair with a 422 when `sector_id` is not
 * `resolve_sector(unit_id)` (ADR-0009), so this is the same question asked
 * before the round trip -- both to warn next to the field and to hold the
 * save back.
 *
 * Deliberately conservative: it reports a mismatch only when it can prove
 * one. No corpus yet (still loading, or the fetch failed) means no answer, so
 * nothing is blocked on a guess and the server stays the backstop. A pair
 * with either id missing is incomplete, not contradictory -- the server
 * accepts it and stores what it got.
 */
export function hasSectorMismatch(
  recipient: RecipientSectorPair,
  corpus: OrganigramUnit[] | undefined,
): boolean {
  if (!corpus || corpus.length === 0) return false;
  if (recipient.macro_sector !== GCBA_MACRO_SECTOR_CODE) return false;
  if (!recipient.unit_id || !recipient.sector_id) return false;
  return !isSectorAncestorOf(recipient.sector_id, recipient.unit_id, corpus);
}
