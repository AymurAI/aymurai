export interface Topic {
  id: string;
  code: string | null;
  name: string;
  active: boolean;
  order: number;
  created_at: string;
  updated_at: string | null;
}

export interface Subtopic {
  id: string;
  topic_id: string;
  code: string | null;
  name: string;
  active: boolean;
  order: number;
  created_at: string;
  updated_at: string | null;
}

export interface CategoryUsage {
  count: number;
}

export interface CreateTopicInput {
  name: string;
  code?: string | null;
  order: number;
}

export interface UpdateTopicInput {
  id: string;
  name?: string;
  code?: string | null;
  order?: number;
  active?: boolean;
}

export interface CreateSubtopicInput {
  topic_id: string;
  name: string;
  code?: string | null;
  order: number;
}

export interface UpdateSubtopicInput {
  id: string;
  name?: string;
  code?: string | null;
  order?: number;
  active?: boolean;
}

export interface ReassignSubtopicInput {
  id: string;
  /** Required by the API: reassignment always moves rows to another subtopic. */
  target_subtopic_id: string;
}
