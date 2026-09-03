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
