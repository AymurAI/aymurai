import { describe, expect, it } from "vitest";
import type { OrganigramUnit } from "@/types/organigram";
import {
  isSectorAncestorOf,
  resolveSector,
  unitPath,
  unitsInSector,
} from "./resolve-sector";

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

// Mirrors the real shape the rules have to survive: sectors sit at several
// different depths (ADR-0001 measured them at 2, 3 and 4), and an autonomous
// body is a sector that hangs off a ministry which is itself a sector.
//
//   jefe (no sector)
//   └── gabinete (no sector)
//       ├── ministerio            [sector]
//       │   ├── ivc               [sector]  <- autonomous body, a leaf
//       │   └── direccion         (no sector)
//       │       └── subdireccion  (no sector)
//       └── vieja                 [sector, inactiva]
//           └── huerfana          (no sector)
const CORPUS: OrganigramUnit[] = [
  aUnit({ id: "jefe", name: "Jefe de Gobierno" }),
  aUnit({ id: "gabinete", name: "Jefatura de Gabinete", parent_id: "jefe" }),
  aUnit({
    id: "ministerio",
    name: "Ministerio de Desarrollo Humano y Hábitat",
    parent_id: "gabinete",
    is_sector: true,
  }),
  aUnit({
    id: "ivc",
    name: "Instituto de Vivienda de la Ciudad",
    parent_id: "ministerio",
    is_sector: true,
  }),
  aUnit({
    id: "direccion",
    name: "Dirección General de Vivienda",
    parent_id: "ministerio",
  }),
  aUnit({
    id: "subdireccion",
    name: "Subdirección de Obras",
    parent_id: "direccion",
  }),
  aUnit({
    id: "vieja",
    name: "Secretaría Disuelta",
    parent_id: "gabinete",
    is_sector: true,
    active: false,
  }),
  aUnit({ id: "huerfana", name: "Unidad Huérfana", parent_id: "vieja" }),
];

describe("resolveSector", () => {
  it("resolves a plain unit to its nearest sector ancestor", () => {
    expect(resolveSector("direccion", CORPUS)?.id).toBe("ministerio");
  });

  it("keeps walking past non-sector ancestors", () => {
    expect(resolveSector("subdireccion", CORPUS)?.id).toBe("ministerio");
  });

  // The IVC case: an autonomous body is its own sector even though it hangs
  // off a ministry that is also a sector. Ancestor-OR-SELF, deepest first.
  it("resolves a unit that is itself a sector to itself, not to its parent sector", () => {
    expect(resolveSector("ivc", CORPUS)?.id).toBe("ivc");
  });

  it("returns null when no ancestor is a sector", () => {
    expect(resolveSector("gabinete", CORPUS)).toBeNull();
  });

  // Mirrors the backend's `resolve_sector`, which requires `is_sector AND
  // active` -- a deactivated sector stops counting as one.
  it("skips an inactive sector and keeps walking up", () => {
    expect(resolveSector("huerfana", CORPUS)).toBeNull();
  });

  it("returns null for an id that is not in the corpus", () => {
    expect(resolveSector("no-existe", CORPUS)).toBeNull();
  });

  it("returns null for a null unit id", () => {
    expect(resolveSector(null, CORPUS)).toBeNull();
  });
});

describe("isSectorAncestorOf", () => {
  it("accepts the sector that actually contains the unit", () => {
    expect(isSectorAncestorOf("ministerio", "direccion", CORPUS)).toBe(true);
  });

  it("accepts a unit that is its own sector", () => {
    expect(isSectorAncestorOf("ivc", "ivc", CORPUS)).toBe(true);
  });

  it("rejects a sector the unit does not belong to", () => {
    expect(isSectorAncestorOf("ivc", "direccion", CORPUS)).toBe(false);
  });

  // The backend's counterpart deliberately ignores `active` for membership:
  // deactivating a sector must not retroactively invalidate what a human
  // already validated under it.
  it("accepts an inactive sector that is still a real ancestor", () => {
    expect(isSectorAncestorOf("vieja", "huerfana", CORPUS)).toBe(true);
  });

  it("rejects the ministerio for a unit under the autonomous body", () => {
    // `ivc` is a leaf, so this is the nearest thing to it: the ministry IS a
    // real ancestor of ivc in the tree, but ivc's own sector is ivc, and the
    // server compares against `resolve_sector`, not against ancestry alone.
    expect(isSectorAncestorOf("ministerio", "ivc", CORPUS)).toBe(false);
  });
});

describe("unitsInSector", () => {
  it("lists the active units whose resolved sector is the given one", () => {
    expect(
      unitsInSector("ministerio", CORPUS)
        .map((u) => u.id)
        .sort(),
    ).toEqual(["direccion", "ministerio", "subdireccion"]);
  });

  it("does not leak units of a nested autonomous body into its parent sector", () => {
    expect(unitsInSector("ministerio", CORPUS).map((u) => u.id)).not.toContain(
      "ivc",
    );
  });

  it("lists a self-sector unit under itself", () => {
    expect(unitsInSector("ivc", CORPUS).map((u) => u.id)).toEqual(["ivc"]);
  });
});

describe("unitPath", () => {
  it("builds the root-to-self chain with the backend's separator", () => {
    expect(unitPath("subdireccion", CORPUS)).toBe(
      "Jefe de Gobierno > Jefatura de Gabinete > Ministerio de Desarrollo Humano y Hábitat > Dirección General de Vivienda > Subdirección de Obras",
    );
  });

  it("returns just the name for a root unit", () => {
    expect(unitPath("jefe", CORPUS)).toBe("Jefe de Gobierno");
  });

  it("returns an empty string for an unknown id", () => {
    expect(unitPath("no-existe", CORPUS)).toBe("");
  });
});
