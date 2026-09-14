import { describe, expect, it } from "vitest";
import { formatDisplayDate } from "./format-date";

describe("formatDisplayDate", () => {
  it("formats a bare ISO date as dd/mm/aaaa", () => {
    expect(formatDisplayDate("2026-11-22")).toBe("22/11/2026");
  });

  it("formats a full ISO timestamp in UTC, not the local timezone", () => {
    // Would read as the 27th in any timezone behind UTC if not forced to UTC.
    expect(formatDisplayDate("2026-08-28T00:00:00Z")).toBe("28/08/2026");
  });

  it("returns the original string unchanged when it cannot be parsed as a date", () => {
    expect(formatDisplayDate("not a date")).toBe("not a date");
  });
});
