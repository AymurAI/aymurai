import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { USE_MOCK_CATALOGS } from "@/constants/config";
import {
  categoryUsageSchema,
  macroSectorsSchema,
  reassignResultSchema,
  subtopicSchema,
  subtopicsSchema,
  topicSchema,
  topicsSchema,
} from "@/schema/catalogs";
import type {
  CreateSubtopicInput,
  CreateTopicInput,
  ReassignSubtopicInput,
  UpdateSubtopicInput,
  UpdateTopicInput,
} from "@/types/catalogs";
import api from "../api";
import * as mock from "./mockCatalogs";

export const listTopics = () =>
  queryOptions({
    queryKey: ["topics", api.defaults.baseURL],
    queryFn: async () => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockListTopics()
        : (
            await api.get("/catalogs/topics", {
              // The settings screen is where inactive categories get reviewed
              // and reactivated, so it asks for them explicitly — the endpoint
              // defaults to active-only.
              params: { include_inactive: true },
            })
          ).data;
      return topicsSchema.parse(data);
    },
  });

export const createTopic = () =>
  mutationOptions({
    mutationFn: async (input: CreateTopicInput) => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockCreateTopic(input)
        : (await api.post("/catalogs/topics", input)).data;
      return topicSchema.parse(data);
    },
  });

export const updateTopic = () =>
  mutationOptions({
    mutationFn: async (input: UpdateTopicInput) => {
      const { id, ...body } = input;
      const data = USE_MOCK_CATALOGS
        ? await mock.mockUpdateTopic(input)
        : (await api.patch(`/catalogs/topics/${id}`, body)).data;
      return topicSchema.parse(data);
    },
  });

export const topicUsage = (topicId: string) =>
  queryOptions({
    queryKey: ["topics", api.defaults.baseURL, topicId, "usage"],
    queryFn: async () => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockTopicUsage(topicId)
        : (await api.get(`/catalogs/topics/${topicId}/usage`)).data;
      return categoryUsageSchema.parse(data);
    },
  });

/** Single-subtopic usage — read when the deactivate/reassign dialog opens. */
export const subtopicUsage = (subtopicId: string) =>
  queryOptions({
    queryKey: ["subtopics", api.defaults.baseURL, "usage", subtopicId],
    queryFn: async () => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockSubtopicUsage(subtopicId)
        : (await api.get(`/catalogs/subtopics/${subtopicId}/usage`)).data;
      return categoryUsageSchema.parse(data);
    },
  });

export const listSubtopics = (topicId?: string) =>
  queryOptions({
    queryKey: ["subtopics", api.defaults.baseURL, topicId ?? null],
    queryFn: async () => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockListSubtopics(topicId)
        : (
            await api.get("/catalogs/subtopics", {
              // See listTopics on include_inactive.
              params: {
                ...(topicId ? { topic_id: topicId } : {}),
                include_inactive: true,
              },
            })
          ).data;
      return subtopicsSchema.parse(data);
    },
  });

export const createSubtopic = () =>
  mutationOptions({
    mutationFn: async (input: CreateSubtopicInput) => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockCreateSubtopic(input)
        : (await api.post("/catalogs/subtopics", input)).data;
      return subtopicSchema.parse(data);
    },
  });

export const updateSubtopic = () =>
  mutationOptions({
    mutationFn: async (input: UpdateSubtopicInput) => {
      const { id, ...body } = input;
      const data = USE_MOCK_CATALOGS
        ? await mock.mockUpdateSubtopic(input)
        : (await api.patch(`/catalogs/subtopics/${id}`, body)).data;
      return subtopicSchema.parse(data);
    },
  });

export const reassignSubtopic = () =>
  mutationOptions({
    mutationFn: async (input: ReassignSubtopicInput) => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockReassignSubtopic(input)
        : (
            await api.post(`/catalogs/subtopics/${input.id}/reassign`, {
              target_subtopic_id: input.target_subtopic_id,
            })
          ).data;
      return reassignResultSchema.parse(data);
    },
  });

/**
 * The 4 fixed macro sectors. Read-only from the recommendation form's point
 * of view (Task 11) — there is no create/update here, unlike topics/
 * subtopics, since nothing in this flow adds or edits one.
 */
export const listMacroSectors = () =>
  queryOptions({
    queryKey: ["macro-sectors", api.defaults.baseURL],
    queryFn: async () => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockListMacroSectors()
        : (
            await api.get("/catalogs/macro_sectors", {
              // See listTopics on include_inactive.
              params: { include_inactive: true },
            })
          ).data;
      return macroSectorsSchema.parse(data);
    },
  });
