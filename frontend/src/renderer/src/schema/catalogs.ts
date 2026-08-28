import { z } from "zod";

export const topicSchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  active: z.boolean(),
  order: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
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
  updated_at: z.string(),
});

export const subtopicsSchema = z.array(subtopicSchema);

export const categoryUsageSchema = z.object({
  count: z.number(),
});
