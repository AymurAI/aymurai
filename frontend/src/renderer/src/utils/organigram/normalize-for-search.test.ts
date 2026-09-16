import { describe, expect, it } from "vitest";
import { normalizeForSearch } from "./normalize-for-search";

describe("normalizeForSearch", () => {
  it("strips accents so an unaccented query can match an accented name", () => {
    expect(
      normalizeForSearch("Ministerio de Desarrollo Humano y Hábitat"),
    ).toBe("ministerio de desarrollo humano y habitat");
  });

  it("normalizes both sides to the same form, so typing the accent still matches", () => {
    expect(normalizeForSearch("Hábitat")).toBe(normalizeForSearch("habitat"));
  });

  it("handles the ñ, which decomposes to n plus a combining tilde", () => {
    expect(normalizeForSearch("Diseño Señalético")).toBe("diseno senaletico");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeForSearch("  Vivienda  ")).toBe("vivienda");
  });

  it("treats null and undefined as the empty string", () => {
    expect(normalizeForSearch(null)).toBe("");
    expect(normalizeForSearch(undefined)).toBe("");
  });
});
