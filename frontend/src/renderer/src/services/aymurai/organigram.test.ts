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

    // `flat` asks for the whole tree in one response instead of one level per
    // request; `include_inactive` because this screen manages inactive units.
    expect(getSpy).toHaveBeenCalledWith("/organigram/units", {
      params: { flat: true, include_inactive: true },
    });
    expect(result).toEqual(units);
  });

  it("creates a unit via POST /organigram/units", async () => {
    const input = {
      parent_id: "u1",
      name: "Nueva Dirección",
      is_sector: false,
    };
    const created = {
      id: "u3",
      parent_id: "u1",
      name: "Nueva Dirección",
      acronym: null,
      short_name: null,
      is_sector: false,
      active: true,
      order: null,
      created_at: "x",
      updated_at: "x",
    };
    const postSpy = vi.spyOn(api, "post").mockResolvedValue({ data: created });

    const { mutationFn } = organigram.createUnit();
    const result = await (mutationFn as (i: typeof input) => Promise<unknown>)(
      input,
    );

    expect(postSpy).toHaveBeenCalledWith("/organigram/units", input);
    expect(result).toEqual(created);
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
    await (
      mutationFn as (i: { id: string; is_sector: boolean }) => Promise<unknown>
    )({
      id: "u2",
      is_sector: true,
    });

    expect(patchSpy).toHaveBeenCalledWith("/organigram/units/u2", {
      is_sector: true,
    });
  });

  it("lists a unit's holder history via GET /organigram/units/{id}/holders", async () => {
    const holders = [
      {
        id: "h1",
        unit_id: "u2",
        name: "María Pérez",
        start_date: "2024-03-11",
        is_current: true,
        created_at: "x",
        updated_at: "x",
      },
    ];
    const getSpy = vi.spyOn(api, "get").mockResolvedValue({ data: holders });

    const { queryFn } = organigram.unitHolders("u2");
    const result = await (queryFn as () => Promise<unknown>)();

    expect(getSpy).toHaveBeenCalledWith("/organigram/units/u2/holders");
    expect(result).toEqual(holders);
  });

  it("inserts a new current holder via POST /organigram/units/{id}/holders", async () => {
    const postSpy = vi.spyOn(api, "post").mockResolvedValue({
      data: {
        id: "h2",
        unit_id: "u2",
        name: "Juan Gómez",
        start_date: "2026-09-04",
        is_current: true,
        created_at: "x",
        updated_at: "x",
      },
    });

    const { mutationFn } = organigram.addHolder();
    await (
      mutationFn as (i: { unit_id: string; name: string }) => Promise<unknown>
    )({
      unit_id: "u2",
      name: "Juan Gómez",
    });

    expect(postSpy).toHaveBeenCalledWith("/organigram/units/u2/holders", {
      name: "Juan Gómez",
    });
  });
});

describe("organigram service — correcting a holder", () => {
  const corrected = {
    id: "h1",
    unit_id: "u2",
    name: "María Pérez",
    start_date: "2020-01-15",
    is_current: true,
    created_at: "x",
    updated_at: "y",
  };

  it("sends only the term date when that is all that changed", async () => {
    // The API rejects a body with neither field and treats an omitted one as
    // "leave it alone", so the client must not pad the payload.
    const patchSpy = vi
      .spyOn(api, "patch")
      .mockResolvedValue({ data: corrected });

    const { mutationFn } = organigram.updateHolder();
    await (
      mutationFn as (i: {
        id: string;
        unit_id: string;
        start_date: string;
      }) => Promise<unknown>
    )({ id: "h1", unit_id: "u2", start_date: "2020-01-15" });

    expect(patchSpy).toHaveBeenCalledWith("/organigram/holders/h1", {
      start_date: "2020-01-15",
    });
  });

  it("sends only the name when that is all that changed", async () => {
    const patchSpy = vi
      .spyOn(api, "patch")
      .mockResolvedValue({ data: corrected });

    const { mutationFn } = organigram.updateHolder();
    await (
      mutationFn as (i: {
        id: string;
        unit_id: string;
        name: string;
      }) => Promise<unknown>
    )({ id: "h1", unit_id: "u2", name: "María Pérez" });

    expect(patchSpy).toHaveBeenCalledWith("/organigram/holders/h1", {
      name: "María Pérez",
    });
  });
});
