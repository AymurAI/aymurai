import { afterEach, describe, expect, it, vi } from "vitest";
import api from "@/services/api";
import * as organigram from "./organigram";

vi.mock("@/constants/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/config")>()),
  USE_MOCK_ORGANIGRAM: false,
}));

describe("organigram service — real (non-mock) implementation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists units from GET /organigram/units", async () => {
    const units = [
      {
        id: "u1",
        parent_id: null,
        name: "Jefatura de Gabinete",
        acronym: null,
        short_name: "Jefatura de Gabinete",
        is_sector: false,
        active: true,
        order: 1,
        created_at: "x",
        updated_at: "x",
      },
    ];
    const getSpy = vi.spyOn(api, "get").mockResolvedValue({ data: units });

    const { queryFn } = organigram.listUnits();
    const result = await (queryFn as () => Promise<unknown>)();

    expect(getSpy).toHaveBeenCalledWith("/organigram/units");
    expect(result).toEqual(units);
  });

  it("patches a unit via PATCH /organigram/units/{id}, including is_sector", async () => {
    const patchSpy = vi.spyOn(api, "patch").mockResolvedValue({
      data: {
        id: "u2",
        parent_id: "u1",
        name: "Secretaría A",
        acronym: "SECA",
        short_name: null,
        is_sector: true,
        active: true,
        order: 1,
        created_at: "x",
        updated_at: "x",
      },
    });

    const { mutationFn } = organigram.updateUnit();
    await (mutationFn as (i: { id: string; is_sector: boolean }) => Promise<unknown>)({
      id: "u2",
      is_sector: true,
    });

    expect(patchSpy).toHaveBeenCalledWith("/organigram/units/u2", { is_sector: true });
  });

  it("lists a unit's holder history via GET /organigram/units/{id}/holders", async () => {
    const holders = [
      { id: "h1", unit_id: "u2", name: "María Pérez", is_current: true, created_at: "x", updated_at: "x" },
    ];
    const getSpy = vi.spyOn(api, "get").mockResolvedValue({ data: holders });

    const { queryFn } = organigram.unitHolders("u2");
    const result = await (queryFn as () => Promise<unknown>)();

    expect(getSpy).toHaveBeenCalledWith("/organigram/units/u2/holders");
    expect(result).toEqual(holders);
  });

  it("inserts a new current holder via POST /organigram/units/{id}/holders", async () => {
    const postSpy = vi.spyOn(api, "post").mockResolvedValue({
      data: { id: "h2", unit_id: "u2", name: "Juan Gómez", is_current: true, created_at: "x", updated_at: "x" },
    });

    const { mutationFn } = organigram.addHolder();
    await (mutationFn as (i: { unit_id: string; name: string }) => Promise<unknown>)({
      unit_id: "u2",
      name: "Juan Gómez",
    });

    expect(postSpy).toHaveBeenCalledWith("/organigram/units/u2/holders", { name: "Juan Gómez" });
  });
});
