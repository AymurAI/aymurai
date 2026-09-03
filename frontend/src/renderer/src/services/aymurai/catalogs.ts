import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { USE_MOCK_CATALOGS } from "@/constants/config";
import {
  categoryUsageSchema,
  reassignResultSchema,
  subtopicSchema,
  subtopicsSchema,
  topicSchema,
  topicsSchema,
  usageMapSchema,
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
        : (await api.get("/catalogs/topics")).data;
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

/**
 * Record counts for every topic, in one request (see `usageMapSchema`).
 * Keyed under the `["topics", baseURL]` prefix so a topic mutation's
 * invalidation refreshes the counts along with the list.
 *
 * Fase 1 (docs/defensoria/PLAN.md) must serve `GET /catalogs/topics/usage`
 * alongside the per-id `/usage` endpoint for this to work against a real backend.
 */
export const topicUsageMap = () =>
  queryOptions({
    queryKey: ["topics", api.defaults.baseURL, "usage-map"],
    queryFn: async () => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockTopicUsageMap()
        : (await api.get("/catalogs/topics/usage")).data;
      return usageMapSchema.parse(data);
    },
  });

/** Record counts for every subtopic of one topic — see `topicUsageMap`. */
export const subtopicUsageMap = (topicId: string) =>
  queryOptions({
    queryKey: ["subtopics", api.defaults.baseURL, topicId, "usage-map"],
    queryFn: async () => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockSubtopicUsageMap(topicId)
        : (
            await api.get("/catalogs/subtopics/usage", {
              params: { topic_id: topicId },
            })
          ).data;
      return usageMapSchema.parse(data);
    },
  });

/** Single-subtopic usage — the endpoint agreed for the deactivation guard. */
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

export const listSubtopics = (topicId: string) =>
  queryOptions({
    queryKey: ["subtopics", api.defaults.baseURL, topicId],
    queryFn: async () => {
      const data = USE_MOCK_CATALOGS
        ? await mock.mockListSubtopics(topicId)
        : (
            await api.get("/catalogs/subtopics", {
              params: { topic_id: topicId },
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
