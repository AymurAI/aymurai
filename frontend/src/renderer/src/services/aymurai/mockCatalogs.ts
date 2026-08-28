import type {
  CategoryUsage,
  CreateSubtopicInput,
  CreateTopicInput,
  ReassignSubtopicInput,
  Subtopic,
  Topic,
  UpdateSubtopicInput,
  UpdateTopicInput,
} from "@/types/catalogs";

const now = "2026-08-28T00:00:00Z";

/**
 * Small, curated fixture (PLAN.md §J: "chico y curado", not the real 242-subtopic
 * taxonomy) — enough to exercise the master-detail UI end to end while Fase 1's real
 * backend doesn't exist on this branch yet.
 */
let topics: Topic[] = [
  {
    id: "topic-acc",
    code: "ACC",
    name: "Acceso a la justicia",
    active: true,
    order: 1,
    created_at: now,
    updated_at: now,
  },
  {
    id: "topic-amb",
    code: "AMB",
    name: "Ambiente",
    active: true,
    order: 2,
    created_at: now,
    updated_at: now,
  },
  {
    id: "topic-sm",
    code: "SM",
    name: "Salud mental",
    active: true,
    order: 3,
    created_at: now,
    updated_at: now,
  },
];

let subtopics: Subtopic[] = [
  {
    id: "sub-acc-1",
    topic_id: "topic-acc",
    code: "ACC20221",
    name: "Patrocinio jurídico gratuito",
    active: true,
    order: 1,
    created_at: now,
    updated_at: now,
  },
  {
    id: "sub-acc-2",
    topic_id: "topic-acc",
    code: "ACC20222",
    name: "Turnos judiciales",
    active: true,
    order: 2,
    created_at: now,
    updated_at: now,
  },
  {
    id: "sub-amb-1",
    topic_id: "topic-amb",
    code: "AMB20221",
    name: "Arbolado urbano",
    active: true,
    order: 1,
    created_at: now,
    updated_at: now,
  },
  {
    id: "sub-sm-1",
    topic_id: "topic-sm",
    code: "SMCA20226",
    name: "Internaciones",
    active: true,
    order: 1,
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
  // Deterministic stand-in: count subtopics under this topic that are referenced —
  // there is no `recommendation` table on the frontend to count against, so this
  // mock reports the subtopic count as a plausible non-zero example.
  const count = subtopics.filter((s) => s.topic_id === topicId).length;
  return delay({ count });
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

export function mockReassignSubtopic(
  input: ReassignSubtopicInput,
): Promise<{ success: true }> {
  // The real endpoint reassigns referencing `recipient` rows server-side; the mock
  // has nothing to reassign, so it only validates the target (when given) exists.
  if (input.target_subtopic_id) {
    const target = subtopics.find((s) => s.id === input.target_subtopic_id);
    if (!target)
      throw new Error(`Unknown target subtopic ${input.target_subtopic_id}`);
  }
  return delay({ success: true });
}
