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

/**
 * Bulk usage: `{ [category_id]: record_count }`. The settings list shows a count
 * on every row, and the real catalog has 25 topics / 242 subtopics — one request
 * per row would be a 242-deep N+1, so the screens read a map instead and the
 * per-id endpoint above stays for single-record callers.
 */
export const usageMapSchema = z.record(z.string(), z.number());

export const reassignResultSchema = z.object({
  success: z.literal(true),
});
