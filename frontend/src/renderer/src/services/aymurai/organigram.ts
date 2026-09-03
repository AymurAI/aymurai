import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { USE_MOCK_ORGANIGRAM } from "@/constants/config";
import {
  organigramHolderSchema,
  organigramHoldersSchema,
  organigramUnitSchema,
  organigramUnitsSchema,
} from "@/schema/organigram";
import type {
  AddHolderInput,
  CreateUnitInput,
  UpdateUnitInput,
} from "@/types/organigram";
import api from "../api";
import * as mock from "./mockOrganigram";

export const listUnits = () =>
  queryOptions({
    queryKey: ["organigram-units", api.defaults.baseURL],
    queryFn: async () => {
      const data = USE_MOCK_ORGANIGRAM
        ? await mock.mockListUnits()
        : (
            await api.get("/organigram/units", {
              // `flat` returns the whole tree in one response; without it the
              // endpoint answers one level at a time, and this screen needs
              // every unit to search, expand-all and show ancestors.
              // `include_inactive` for the same reason as the catalogs lists.
              params: { flat: true, include_inactive: true },
            })
          ).data;
      return organigramUnitsSchema.parse(data);
    },
  });

export const createUnit = () =>
  mutationOptions({
    mutationFn: async (input: CreateUnitInput) => {
      const data = USE_MOCK_ORGANIGRAM
        ? await mock.mockCreateUnit(input)
        : (await api.post("/organigram/units", input)).data;
      return organigramUnitSchema.parse(data);
    },
  });

export const updateUnit = () =>
  mutationOptions({
    mutationFn: async (input: UpdateUnitInput) => {
      const { id, ...body } = input;
      const data = USE_MOCK_ORGANIGRAM
        ? await mock.mockUpdateUnit(input)
        : (await api.patch(`/organigram/units/${id}`, body)).data;
      return organigramUnitSchema.parse(data);
    },
  });

export const unitHolders = (unitId: string) =>
  queryOptions({
    queryKey: ["organigram-units", api.defaults.baseURL, unitId, "holders"],
    queryFn: async () => {
      const data = USE_MOCK_ORGANIGRAM
        ? await mock.mockUnitHolders(unitId)
        : (await api.get(`/organigram/units/${unitId}/holders`)).data;
      return organigramHoldersSchema.parse(data);
    },
  });

export const addHolder = () =>
  mutationOptions({
    mutationFn: async (input: AddHolderInput) => {
      const data = USE_MOCK_ORGANIGRAM
        ? await mock.mockAddHolder(input)
        : (
            await api.post(`/organigram/units/${input.unit_id}/holders`, {
              name: input.name,
            })
          ).data;
      return organigramHolderSchema.parse(data);
    },
  });
