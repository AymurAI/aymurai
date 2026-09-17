import { describe, expect, it } from "vitest";
import { generateSplits } from "./generateSplits";

describe("generateSplits", () => {
  it("passes through annotations that are neither tag nor search", () => {
    const extracted = {
      type: "extracted" as const,
      start: 0,
      end: 5,
      paragraphId: "p1",
      field: "recommendation_number",
    };

    const splits = generateSplits("hola mundo", [extracted]);

    expect(splits.some((s) => s.type === "extracted")).toBe(true);
  });

  it("drops an extracted annotation that overlaps a search hit", () => {
    // Search is the user's active intent and wins the overlap, deliberately.
    const extracted = {
      type: "extracted" as const,
      start: 0,
      end: 5,
      paragraphId: "p1",
      field: "recommendation_number",
    };
    const search = {
      type: "search" as const,
      start: 2,
      end: 7,
      paragraphId: "p1",
      searchMatchId: "s1",
    };

    const splits = generateSplits("hola mundo", [extracted, search]);

    expect(splits.some((s) => s.type === "extracted")).toBe(false);
  });
});
