import type {
  CategoryUsage,
  CreateSubtopicInput,
  CreateTopicInput,
  MacroSector,
  ReassignSubtopicInput,
  Subtopic,
  Topic,
  UpdateSubtopicInput,
  UpdateTopicInput,
} from "@/types/catalogs";
import taxonomyFixture from "./fixtures/taxonomy.json";

const now = "2026-08-28T00:00:00Z";

/**
 * Seed = the **real** Defensoría consultation taxonomy (25 temas / 242 subtemas),
 * not a curated sample. `fixtures/taxonomy.json` is GENERATED from the source
 * dataset by `scripts/generate-defensoria-fixtures.mjs` — re-run that script
 * rather than hand-editing the JSON. The script's header documents provenance
 * and the `area`/`tema`/`codigo`/`descripcion` → topic/subtopic mapping.
 *
 * The cast is the type boundary: TypeScript infers plain `string` for the JSON's
 * nullable `code` column, so the fixture is asserted to the domain types once,
 * here, instead of leaking `any` into every consumer.
 */
const seed = taxonomyFixture as { topics: Topic[]; subtopics: Subtopic[] };

let topics: Topic[] = seed.topics;
let subtopics: Subtopic[] = seed.subtopics;

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

// --- usage counts -----------------------------------------------------------
//
// There is no `recommendation` table on the frontend, so per-row record counts
// are synthesised. They must be *stable*: the same id has to yield the same
// count across reloads and across every usage function, otherwise a row's
// badge and its deactivation guard would disagree. A small FNV-1a hash of the
// id gives that for free — no state, no randomness.
//
// A subtopic is the unit of counting; a topic's count is the sum of its
// subtopics'. That keeps the two levels coherent and makes a freshly created
// topic (no subtopics yet) report 0 without any special case.

/** Plausible upper bound for a single subtopic's record count. */
const MAX_SUBTOPIC_USAGE = 180;

/** FNV-1a, 32-bit. Stable across runs and platforms — no `Math.random`. */
function hashId(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Subtopics created at runtime start with no records, like the real backend. */
const createdSubtopicIds = new Set<string>();

function subtopicUsageCount(subtopicId: string): number {
  if (createdSubtopicIds.has(subtopicId)) return 0;
  const hash = hashId(subtopicId);
  // Roughly one row in eight has no records at all, so the zero-usage UI path
  // (deactivate/delete without reassignment) is reachable from the seed data.
  if (hash % 8 === 0) return 0;
  return (hash >>> 3) % (MAX_SUBTOPIC_USAGE + 1);
}

function topicUsageCount(topicId: string): number {
  return subtopics
    .filter((s) => s.topic_id === topicId)
    .reduce((total, s) => total + subtopicUsageCount(s.id), 0);
}

export function mockListTopics(): Promise<Topic[]> {
  return delay([...topics].sort((a, b) => a.order - b.order));
}

export function mockCreateTopic(input: CreateTopicInput): Promise<Topic> {
  const created: Topic = {
    id: makeId("topic"),
    code: input.code ?? null,
    name: input.name,
    order: input.order,
    active: true,
    created_at: now,
    updated_at: now,
  };
  topics = [...topics, created];
  return delay(created);
}

export function mockUpdateTopic(input: UpdateTopicInput): Promise<Topic> {
  const existing = topics.find((t) => t.id === input.id);
  if (!existing) throw new Error(`Unknown topic ${input.id}`);
  const updated: Topic = { ...existing, ...input, updated_at: now };
  topics = topics.map((t) => (t.id === input.id ? updated : t));
  return delay(updated);
}

export function mockTopicUsage(topicId: string): Promise<CategoryUsage> {
  return delay({ count: topicUsageCount(topicId) });
}

/** Single-subtopic count; a topic's count is the sum of its subtopics'. */
export function mockSubtopicUsage(subtopicId: string): Promise<CategoryUsage> {
  return delay({ count: subtopicUsageCount(subtopicId) });
}

export function mockListSubtopics(topicId: string): Promise<Subtopic[]> {
  return delay(
    subtopics
      .filter((s) => s.topic_id === topicId)
      .sort((a, b) => a.order - b.order),
  );
}

export function mockCreateSubtopic(
  input: CreateSubtopicInput,
): Promise<Subtopic> {
  const created: Subtopic = {
    id: makeId("sub"),
    topic_id: input.topic_id,
    code: input.code ?? null,
    name: input.name,
    order: input.order,
    active: true,
    created_at: now,
    updated_at: now,
  };
  subtopics = [...subtopics, created];
  createdSubtopicIds.add(created.id);
  return delay(created);
}

export function mockUpdateSubtopic(
  input: UpdateSubtopicInput,
): Promise<Subtopic> {
  const existing = subtopics.find((s) => s.id === input.id);
  if (!existing) throw new Error(`Unknown subtopic ${input.id}`);
  const updated: Subtopic = { ...existing, ...input, updated_at: now };
  subtopics = subtopics.map((s) => (s.id === input.id ? updated : s));
  return delay(updated);
}

// The 4 macro sectors hardcoded in the historical prompt, mirroring the
// real backend's seed (`aymurai/database/seed/catalogs.py`) exactly — this
// is mock-backend seed data, not a taxonomy the form hardcodes: the form
// itself only ever reads it through `listMacroSectors()`.
const macroSectors: MacroSector[] = [
  { code: "GCBA", name: "GCBA", order: 0 },
  {
    code: "ORGANISMOS_NACIONALES",
    name: "Organismos Nacionales",
    order: 1,
  },
  { code: "OBRA_SOCIAL_PREPAGA", name: "Obra Social / Prepaga", order: 2 },
  { code: "EMPRESA", name: "Empresa", order: 3 },
].map((entry, index) => ({
  id: `macro-sector-${index}`,
  active: true,
  created_at: now,
  updated_at: now,
  ...entry,
}));

export function mockListMacroSectors(): Promise<MacroSector[]> {
  return delay([...macroSectors].sort((a, b) => a.order - b.order));
}

export function mockReassignSubtopic(
  input: ReassignSubtopicInput,
): Promise<{ reassigned: number }> {
  // The real endpoint moves referencing `recipient` rows server-side and answers
  // with how many it moved; the mock has no rows, so it reports the source's
  // usage count — the same number the UI just showed in the dialog.
  const target = subtopics.find((s) => s.id === input.target_subtopic_id);
  if (!target)
    throw new Error(`Unknown target subtopic ${input.target_subtopic_id}`);
  return delay({ reassigned: subtopicUsageCount(input.id) });
}
