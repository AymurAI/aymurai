import { z } from "zod";

export const organigramUnitSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable(),
  name: z.string(),
  acronym: z.string().nullable(),
  short_name: z.string().nullable(),
  is_sector: z.boolean(),
  active: z.boolean(),
  order: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

export const organigramUnitsSchema = z.array(organigramUnitSchema);

export const organigramHolderSchema = z.object({
  id: z.string(),
  unit_id: z.string(),
  name: z.string(),
  /** ISO date (YYYY-MM-DD) the term began, or null on a pre-migration row. */
  start_date: z.string().nullable(),
  is_current: z.boolean(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

export const organigramHoldersSchema = z.array(organigramHolderSchema);
