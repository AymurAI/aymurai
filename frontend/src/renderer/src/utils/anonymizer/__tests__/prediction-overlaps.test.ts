import { describe, expect, it } from "vitest";
import type { PredictLabel } from "@/types/aymurai";
import {
  findOverlapConflict,
  hasInternalOverlap,
  rangesOverlap,
} from "../prediction-overlaps";

function label(
  paragraphId: string,
  start: number,
  end: number,
  overrides: Partial<PredictLabel> = {},
): PredictLabel {
  return {
    mentionId: `${paragraphId}:${start}:${end}`,
    text: "x".repeat(end - start),
    start_char: start,
    end_char: end,
    paragraphId,
    attrs: {
      aymurai_label: "PER",
      aymurai_label_subclass: null,
      aymurai_alt_text: null,
      aymurai_alt_start_char: start,
      aymurai_alt_end_char: end,
    },
    ...overrides,
  } as PredictLabel;
}

describe("rangesOverlap", () => {
  it("detects intersecting ranges", () => {
    expect(rangesOverlap(label("p", 0, 10), label("p", 5, 15))).toBe(true);
  });

  it("treats touching ranges as non-overlapping", () => {
    expect(rangesOverlap(label("p", 0, 10), label("p", 10, 15))).toBe(false);
  });
});

describe("hasInternalOverlap", () => {
  it("flags overlapping candidates in the same paragraph", () => {
    expect(hasInternalOverlap([label("p", 0, 10), label("p", 5, 15)])).toBe(
      true,
    );
  });

  it("allows same ranges in different paragraphs", () => {
    expect(hasInternalOverlap([label("p1", 0, 10), label("p2", 0, 10)])).toBe(
      false,
    );
  });
});

describe("findOverlapConflict", () => {
  it("reports a conflict against any existing prediction, including inactive ones", () => {
    // Existing prediction belongs to an excluded/inactive tag: it must still
    // block a manual addition, otherwise the export fails later with no
    // visible counterpart in the document view.
    const existing = [label("p", 20, 30, { mentionId: "existing" })];
    const candidate = label("p", 25, 40, { mentionId: "candidate" });

    const conflict = findOverlapConflict(existing, [candidate]);

    expect(conflict).not.toBeNull();
    expect(conflict?.candidate.mentionId).toBe("candidate");
    expect(conflict?.existing.mentionId).toBe("existing");
  });

  it("ignores predictions in other paragraphs", () => {
    const existing = [label("p1", 20, 30)];
    expect(findOverlapConflict(existing, [label("p2", 25, 40)])).toBeNull();
  });

  it("returns null when there is no overlap", () => {
    const existing = [label("p", 0, 10)];
    expect(findOverlapConflict(existing, [label("p", 10, 20)])).toBeNull();
  });
});
