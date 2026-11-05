import { describe, expect, it } from "vitest";
import { validateGridSearch } from "./recommendations-grid-search";

const TOPIC = "8f14e45f-ceea-4e7a-9b1c-2d3e4f5a6b7c";
const SUBTOPIC = "c9f0f895-fb98-4b9e-8a6d-1e2f3a4b5c6d";
const SECTOR = "45c48cce-2e2d-4fbd-a1b2-c3d4e5f6a7b8";

describe("validateGridSearch", () => {
  it("keeps every recognised value", () => {
    const search = {
      q: "salud",
      topicId: TOPIC,
      subtopicId: SUBTOPIC,
      recipientSector: `sector:${SECTOR}`,
      situation: "Respuesta",
      status: "Solucionado",
      publication: "unanswered",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      editedFrom: "2026-02-01",
      editedTo: "2026-02-28",
      page: 3,
      orderBy: "file_number",
      orderDir: "asc",
      view: "recipients",
    };
    expect(validateGridSearch(search)).toEqual(search);
  });

  it("leaves defaults and empty values out of the URL", () => {
    expect(
      validateGridSearch({
        q: "",
        page: 1,
        orderBy: "last_edited",
        orderDir: "desc",
        view: "seguimiento",
      }),
    ).toEqual({});
  });

  it("drops malformed or unknown values instead of failing the route", () => {
    expect(
      validateGridSearch({
        page: 0,
        orderBy: "publishable_content",
        orderDir: "sideways",
        publication: "maybe",
        view: "kanban",
        topicId: ["t1"],
        unrelated: "x",
      }),
    ).toEqual({});
  });

  it("reads a search that the URL parser decoded as a number back as text", () => {
    expect(validateGridSearch({ q: 123, page: "2" })).toEqual({
      q: "123",
      page: 2,
    });
  });

  it.each([
    ["dateFrom", "01/02/2026"],
    ["dateTo", "2026-1-5"],
    ["editedFrom", "2026-02-30"],
    ["editedTo", "ayer"],
    ["topicId", "t1"],
    ["subtopicId", "not-a-uuid"],
    ["recipientSector", SECTOR],
    ["recipientSector", `unit:${SECTOR}`],
    ["recipientSector", "macro:m1"],
  ])("drops a malformed %s (%s)", (key, value) => {
    expect(validateGridSearch({ [key]: value })).toEqual({});
  });

  it("keeps a macro-sector pick and catalog labels as given", () => {
    // Situación and estado are the server's catalogs (`recommendation-enums`)
    // and never written out in TS, so the URL can only insist on non-empty.
    expect(
      validateGridSearch({
        recipientSector: `macro:${SECTOR}`,
        situation: "Respuesta parcial",
        status: "",
      }),
    ).toEqual({
      recipientSector: `macro:${SECTOR}`,
      situation: "Respuesta parcial",
    });
  });
});
