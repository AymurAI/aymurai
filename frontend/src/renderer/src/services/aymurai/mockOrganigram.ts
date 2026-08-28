import type {
  AddHolderInput,
  CreateUnitInput,
  OrganigramHolder,
  OrganigramUnit,
  UpdateUnitInput,
} from "@/types/organigram";

const now = "2026-08-28T00:00:00Z";

/**
 * Small, curated fixture (PLAN.md §J: don't couple unit tests to the real 489-node
 * organigram) covering the shapes the UI needs to exercise: a non-sector root, a
 * sector child, and a grandchild — enough to prove tree nesting + is_sector editing
 * + holder history without the real Fase 2 backend.
 */
let units: OrganigramUnit[] = [
  {
    id: "jg",
    parent_id: null,
    name: "Jefatura de Gabinete",
    acronym: null,
    short_name: "Jefatura de Gabinete",
    is_sector: false,
    active: true,
    order: 1,
    created_at: now,
    updated_at: now,
  },
  {
    id: "seca",
    parent_id: "jg",
    name: "Secretaría de Cultura",
    acronym: "SECA",
    short_name: null,
    is_sector: true,
    active: true,
    order: 1,
    created_at: now,
    updated_at: now,
  },
  {
    id: "dgta",
    parent_id: "seca",
    name: "Dirección General Técnica Administrativa",
    acronym: "DGTA",
    short_name: null,
    is_sector: false,
    active: true,
    order: 1,
    created_at: now,
    updated_at: now,
  },
];

let holders: OrganigramHolder[] = [
  {
    id: "h-seca-1",
    unit_id: "seca",
    name: "María Pérez",
    is_current: true,
    created_at: now,
    updated_at: now,
  },
];

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
