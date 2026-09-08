import { describe, expect, it } from "vitest";
import { parseSpanishProseDate } from "./parse-spanish-date";

describe("parseSpanishProseDate", () => {
  it("parses 'D de MES de YYYY' into YYYY-MM-DD", () => {
    expect(parseSpanishProseDate("10 de julio de 2024")).toBe("2024-07-10");
  });

  it("is case-insensitive and tolerates 'del'", () => {
    expect(parseSpanishProseDate("15 de Marzo del 2023")).toBe("2023-03-15");
  });

  it("returns null for prose with no year", () => {
    expect(parseSpanishProseDate("22 de noviembre")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseSpanishProseDate(null)).toBeNull();
  });

  it("returns null for unparseable text", () => {
    expect(parseSpanishProseDate("no es una fecha")).toBeNull();
  });
});
