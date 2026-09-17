export interface OrganigramUnit {
  id: string;
  parent_id: string | null;
  name: string;
  acronym: string | null;
  short_name: string | null;
  is_sector: boolean;
  active: boolean;
  order: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface OrganigramHolder {
  id: string;
  unit_id: string;
  name: string;
  /**
   * When the term began, as `YYYY-MM-DD`. Distinct from `created_at`, which
   * says when the row was written — the two differ whenever a real history is
   * entered after the fact. Null only on rows written before the column
   * existed and never corrected since.
   */
  start_date: string | null;
  is_current: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface CreateUnitInput {
  parent_id: string | null;
  name: string;
  acronym?: string | null;
  short_name?: string | null;
  is_sector?: boolean;
  order?: number | null;
}

export interface UpdateUnitInput {
  id: string;
  name?: string;
  acronym?: string | null;
  short_name?: string | null;
  is_sector?: boolean;
  active?: boolean;
  order?: number | null;
}

export interface AddHolderInput {
  unit_id: string;
  name: string;
}

export interface UpdateHolderInput {
  id: string;
  /** Omitted when only the term date is being corrected. */
  name?: string;
  /** `YYYY-MM-DD`. Omitted when only the name is being corrected. */
  start_date?: string;
  /** Not sent — the panel needs it to invalidate the right holder list. */
  unit_id: string;
}
