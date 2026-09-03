import type {
  AddHolderInput,
  CreateUnitInput,
  OrganigramHolder,
  OrganigramUnit,
  UpdateHolderInput,
  UpdateUnitInput,
} from "@/types/organigram";
import organigramFixture from "./fixtures/organigram.json";

const now = "2026-08-28T00:00:00Z";

/**
 * Seed = the **real** GCBA organigram (520 units, 7 levels deep, 489 of them with
 * a sitting titular), not a curated sample. `fixtures/organigram.json` is
 * GENERATED from the source tree by `scripts/generate-defensoria-fixtures.mjs`
 * — re-run that script rather than hand-editing the JSON. Its header documents
 * provenance and the `cargo`/`sigla`/`nombre` → unit/holder mapping.
 *
 * `is_sector` is not in the source data: per ADR-0001 (`docs/adr/0001-sector-como-
 * atributo-del-nodo.md`) the generator runs the five historical text rules once,
 * exactly as the backend seed does, and materialises the result as a boolean on
 * 33 nodes (at depths 2, 3 and 4 — the ADR's verification target).
 *
 * Units come out in pre-order DFS, so a parent always precedes its children.
 *
 * The cast is the type boundary: TypeScript infers plain `string` for the JSON's
 * nullable columns, so the fixture is asserted to the domain types once, here,
 * instead of leaking `any` into every consumer.
 */
const seed = organigramFixture as {
  units: OrganigramUnit[];
  holders: OrganigramHolder[];
};

let units: OrganigramUnit[] = seed.units;
let holders: OrganigramHolder[] = seed.holders;

const MOCK_DELAY_MS = 200;
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(value), MOCK_DELAY_MS),
  );
}

let nextId = 100;
function makeId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

export function mockListUnits(): Promise<OrganigramUnit[]> {
  return delay([...units]);
}

export function mockCreateUnit(
  input: CreateUnitInput,
): Promise<OrganigramUnit> {
  const created: OrganigramUnit = {
    id: makeId("unit"),
    parent_id: input.parent_id,
    name: input.name,
    acronym: input.acronym ?? null,
    short_name: input.short_name ?? null,
    is_sector: input.is_sector ?? false,
    active: true,
    order: input.order ?? null,
    created_at: now,
    updated_at: now,
  };
  units = [...units, created];
  return delay(created);
}

export function mockUpdateUnit(
  input: UpdateUnitInput,
): Promise<OrganigramUnit> {
  const existing = units.find((u) => u.id === input.id);
  if (!existing) throw new Error(`Unknown unit ${input.id}`);
  const updated: OrganigramUnit = { ...existing, ...input, updated_at: now };
  units = units.map((u) => (u.id === input.id ? updated : u));
  return delay(updated);
}

export function mockUnitHolders(unitId: string): Promise<OrganigramHolder[]> {
  return delay(
    holders
      .filter((h) => h.unit_id === unitId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  );
}

export function mockAddHolder(
  input: AddHolderInput,
): Promise<OrganigramHolder> {
  // Mirrors the backend's unique-partial-index behavior (PLAN.md §D.2): inserting a
  // new current holder supersedes the previous one instead of overwriting it.
  holders = holders.map((h) =>
    h.unit_id === input.unit_id
      ? { ...h, is_current: false, updated_at: now }
      : h,
  );
  const created: OrganigramHolder = {
    id: makeId("holder"),
    unit_id: input.unit_id,
    name: input.name,
    is_current: true,
    created_at: now,
    updated_at: now,
  };
  holders = [...holders, created];
  return delay(created);
}

export function mockUpdateHolder(
  input: UpdateHolderInput,
): Promise<OrganigramHolder> {
  const existing = holders.find((h) => h.id === input.id);
  if (!existing) throw new Error(`Unknown holder ${input.id}`);
  // A rename corrects the record in place: `is_current` and `created_at` are
  // untouched, so fixing a typo does not look like a change of office.
  const updated: OrganigramHolder = {
    ...existing,
    name: input.name,
    updated_at: now,
  };
  holders = holders.map((h) => (h.id === input.id ? updated : h));
  return delay(updated);
}
