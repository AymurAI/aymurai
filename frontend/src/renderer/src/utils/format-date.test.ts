import { describe, expect, it } from "vitest";
import { formatDisplayDate, formatDisplayTimestamp } from "./format-date";

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

describe("formatDisplayTimestamp", () => {
  // The whole point of the function: the API sends `created_at`/`updated_at`
  // with no designator, and the instant it means is UTC. Asserted as an
  // equality between the two spellings rather than against a literal, so the
  // test says the same thing in every timezone a machine might run it in.
  it("reads an offset-less datetime as UTC, not as local time", () => {
    expect(formatDisplayTimestamp("2026-09-22T23:30:00")).toBe(
      formatDisplayTimestamp("2026-09-22T23:30:00Z"),
    );
  });

  it("leaves an explicit offset alone", () => {
    // 23:30-03:00 is 02:30Z the next day -- the same instant, so the same
    // rendering. If the `Z` were appended regardless, these would differ.
    expect(formatDisplayTimestamp("2026-09-22T23:30:00-03:00")).toBe(
      formatDisplayTimestamp("2026-09-23T02:30:00Z"),
    );
  });

  it("includes the time of day, not just the calendar date", () => {
    const morning = formatDisplayTimestamp("2026-09-22T01:00:00");
    const evening = formatDisplayTimestamp("2026-09-22T13:00:00");
    expect(morning).not.toBe(evening);
    expect(morning).toMatch(/\d{2}\/\d{2}\/\d{4}.*\d{2}:\d{2}/);
  });

  it("returns the original string unchanged when it cannot be parsed", () => {
    expect(formatDisplayTimestamp("not a date")).toBe("not a date");
  });
});
