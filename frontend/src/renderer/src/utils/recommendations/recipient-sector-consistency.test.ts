import { describe, expect, it } from "vitest";
import type { OrganigramUnit } from "@/types/organigram";
import { hasSectorMismatch } from "./recipient-sector-consistency";

function aUnit(
  partial: Partial<OrganigramUnit> & { id: string },
): OrganigramUnit {
  return {
    parent_id: null,
    name: partial.id,
    acronym: null,
    short_name: null,
    is_sector: false,
    active: true,
    order: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    ...partial,
  };
}

//   ministerio      [sector]
//   ├── ivc         [sector]  <- autonomous body
//   └── direccion   (no sector)
//   otro            [sector]
const CORPUS: OrganigramUnit[] = [
  aUnit({ id: "ministerio", is_sector: true }),
  aUnit({ id: "ivc", parent_id: "ministerio", is_sector: true }),
  aUnit({ id: "direccion", parent_id: "ministerio" }),
  aUnit({ id: "otro", is_sector: true }),
];

function aRecipient(partial: Partial<Parameters<typeof hasSectorMismatch>[0]>) {
  return {
    macro_sector: "GCBA",
    unit_id: null,
    sector_id: null,
    ...partial,
  };
}

describe("hasSectorMismatch", () => {
  it("accepts a unit paired with the sector that contains it", () => {
    expect(
      hasSectorMismatch(
        aRecipient({ unit_id: "direccion", sector_id: "ministerio" }),
        CORPUS,
      ),
    ).toBe(false);
  });

  it("accepts a unit that is its own sector paired with itself", () => {
    expect(
      hasSectorMismatch(
        aRecipient({ unit_id: "ivc", sector_id: "ivc" }),
        CORPUS,
      ),
    ).toBe(false);
  });

  it("reports a sector the unit does not belong to", () => {
    expect(
      hasSectorMismatch(
        aRecipient({ unit_id: "direccion", sector_id: "otro" }),
        CORPUS,
      ),
    ).toBe(true);
  });

  // The bug this whole change fixes wrote the sector's id into both columns.
  // For an autonomous body that pairing is legitimate, but for a unit whose
  // sector is an ancestor it is not -- and must be caught.
  it("reports the degenerate pair the old form used to save", () => {
    expect(
      hasSectorMismatch(
        aRecipient({ unit_id: "ministerio", sector_id: "ministerio" }),
        CORPUS,
      ),
    ).toBe(false); // a ministry IS its own sector, so this pair is fine
    expect(
      hasSectorMismatch(
        aRecipient({ unit_id: "direccion", sector_id: "direccion" }),
        CORPUS,
      ),
    ).toBe(true); // but a plain unit paired with itself is not
  });

  it("says nothing about a recipient outside the GCBA", () => {
    expect(
      hasSectorMismatch(
        aRecipient({
          macro_sector: "Organismos Nacionales",
          unit_id: "direccion",
          sector_id: "otro",
        }),
        CORPUS,
      ),
    ).toBe(false);
  });

  it("treats an incomplete pair as incomplete, not contradictory", () => {
    expect(
      hasSectorMismatch(aRecipient({ unit_id: "direccion" }), CORPUS),
    ).toBe(false);
    expect(hasSectorMismatch(aRecipient({ sector_id: "otro" }), CORPUS)).toBe(
      false,
    );
  });

  // Nothing may be blocked on a guess: with no corpus the rule cannot prove
  // anything, and the server's own 422 stays the backstop.
  it("reports nothing while the corpus has not loaded", () => {
    expect(
      hasSectorMismatch(
        aRecipient({ unit_id: "direccion", sector_id: "otro" }),
        undefined,
      ),
    ).toBe(false);
    expect(
      hasSectorMismatch(
        aRecipient({ unit_id: "direccion", sector_id: "otro" }),
        [],
      ),
    ).toBe(false);
  });
});
