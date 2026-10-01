import { describe, expect, it } from "vitest";
import { validateGridSearch } from "./recommendations-grid-search";

describe("validateGridSearch", () => {
  it("keeps every recognised value", () => {
    const search = {
      q: "salud",
      topicId: "t1",
      subtopicId: "st1",
      recipientSector: "sector:s1",
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
});
