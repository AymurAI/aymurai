import { z } from "zod";

export const topicSchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  active: z.boolean(),
  order: z.number(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

export const topicsSchema = z.array(topicSchema);

export const subtopicSchema = z.object({
  id: z.string(),
  topic_id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  active: z.boolean(),
  order: z.number(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

export const subtopicsSchema = z.array(subtopicSchema);

export const macroSectorSchema = z.object({
  id: z.string(),
  // Never nullable, unlike topic/subtopic's `code` — see the type's comment.
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  order: z.number(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

export const macroSectorsSchema = z.array(macroSectorSchema);

export const categoryUsageSchema = z.object({
  count: z.number(),
});

/** `POST /catalogs/subtopics/{id}/reassign` answers with how many rows moved. */
export const reassignResultSchema = z.object({
  reassigned: z.number(),
});
