import { afterEach, describe, expect, it, vi } from "vitest";
import api from "@/services/api";
import * as catalogs from "./catalogs";

vi.mock("@/constants/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/config")>()),
  USE_MOCK_CATALOGS: false,
}));

describe("catalogs service — real (non-mock) implementation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists topics from GET /catalogs/topics", async () => {
    const topics = [
      {
        id: "t1",
        code: "ACC",
        name: "Acceso a la justicia",
        active: true,
        order: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const getSpy = vi.spyOn(api, "get").mockResolvedValue({ data: topics });

    const { queryFn } = catalogs.listTopics();
    const result = await (queryFn as () => Promise<unknown>)();

    // The settings screen manages inactive categories, so it opts into them —
    // the endpoint returns active-only by default.
    expect(getSpy).toHaveBeenCalledWith("/catalogs/topics", {
      params: { include_inactive: true },
    });
    expect(result).toEqual(topics);
  });

  it("creates a topic via POST /catalogs/topics", async () => {
    const input = { name: "Nuevo tema", code: null, order: 99 };
    const created = {
      id: "t2",
      ...input,
      active: true,
      created_at: "x",
      updated_at: "x",
    };
    const postSpy = vi.spyOn(api, "post").mockResolvedValue({ data: created });

    const { mutationFn } = catalogs.createTopic();
    const result = await (mutationFn as (i: typeof input) => Promise<unknown>)(
      input,
    );

    expect(postSpy).toHaveBeenCalledWith("/catalogs/topics", input);
    expect(result).toEqual(created);
  });

  it("fetches usage count via GET /catalogs/topics/{id}/usage", async () => {
    const getSpy = vi
      .spyOn(api, "get")
      .mockResolvedValue({ data: { count: 3 } });

    const { queryFn } = catalogs.topicUsage("t1");
    const result = await (queryFn as () => Promise<{ count: number }>)();

    expect(getSpy).toHaveBeenCalledWith("/catalogs/topics/t1/usage");
    expect(result).toEqual({ count: 3 });
  });

  it("lists macro sectors from GET /catalogs/macro_sectors", async () => {
    const macroSectors = [
      {
        id: "m1",
        code: "GCBA",
        name: "GCBA",
        active: true,
        order: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const getSpy = vi
      .spyOn(api, "get")
      .mockResolvedValue({ data: macroSectors });

    const { queryFn } = catalogs.listMacroSectors();
    const result = await (queryFn as () => Promise<unknown>)();

    expect(getSpy).toHaveBeenCalledWith("/catalogs/macro_sectors", {
      params: { include_inactive: true },
    });
    expect(result).toEqual(macroSectors);
  });

  it("lists every subtopic when no topic is selected", async () => {
    const subtopics = [
      {
        id: "s1",
        topic_id: "t1",
        code: "SAL-1",
        name: "Hospitales",
        active: true,
        order: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const getSpy = vi.spyOn(api, "get").mockResolvedValue({ data: subtopics });

    const { queryFn } = catalogs.listSubtopics();
    const result = await (queryFn as () => Promise<unknown>)();

    expect(getSpy).toHaveBeenCalledWith("/catalogs/subtopics", {
      params: { include_inactive: true },
    });
    expect(getSpy.mock.calls[0][1]?.params).not.toHaveProperty("topic_id");
    expect(result).toEqual(subtopics);
  });

  it("reassigns a subtopic via POST /catalogs/subtopics/{id}/reassign", async () => {
    const postSpy = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: { reassigned: 3 } });

    const { mutationFn } = catalogs.reassignSubtopic();
    await (
      mutationFn as (i: {
        id: string;
        target_subtopic_id: string;
      }) => Promise<unknown>
    )({ id: "s1", target_subtopic_id: "s2" });

    expect(postSpy).toHaveBeenCalledWith("/catalogs/subtopics/s1/reassign", {
      target_subtopic_id: "s2",
    });
  });
});

describe("catalogs service — validates responses with zod", () => {
  it("rejects a malformed topic list instead of silently passing it through", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [{ id: "t1" }] }); // missing required fields

    const { queryFn } = catalogs.listTopics();
    await expect((queryFn as () => Promise<unknown>)()).rejects.toThrow();
  });
});
