import type { PredictLabel } from "@/types/aymurai";
import { describe, expect, it } from "vitest";
import { comparePrediction } from "../utils";

function makeLabel(overrides: Partial<PredictLabel> = {}): PredictLabel {
  return {
    mentionId: "mention-1",
    text: "Ana Perez",
    start_char: 10,
    end_char: 19,
    paragraphId: "p1",
    attrs: {
      aymurai_label: "PER",
      aymurai_label_subclass: null,
      aymurai_alt_text: null,
      aymurai_alt_start_char: 10,
      aymurai_alt_end_char: 19,
    },
    ...overrides,
  } as PredictLabel;
}

describe("comparePrediction", () => {
  it("matches by mentionId when both sides have one", () => {
    const a = makeLabel();
    const b = makeLabel({ text: "different", start_char: 0, end_char: 9 });

    expect(comparePrediction(a, b)).toBe(true);
  });

  it("matches by position and label when one side lost its mentionId, even if the text diverged", () => {
    // The rendered annotation rebuilds its data from the DOM split: the
    // mentionId can be lost ("") and the visible text can diverge from the
    // stored prediction. Deleting must still find the stored prediction.
    const rendered = makeLabel({ mentionId: "", text: "Ana Pere\u0301z" });
    const stored = makeLabel();

    expect(comparePrediction(rendered, stored)).toBe(true);
  });

  it("does not match different ranges", () => {
    const rendered = makeLabel({ mentionId: "", start_char: 0, end_char: 9 });
    const stored = makeLabel();

    expect(comparePrediction(rendered, stored)).toBe(false);
  });

  it("does not match different labels at the same range", () => {
    const rendered = makeLabel({
      mentionId: "",
      attrs: {
        aymurai_label: "LOC",
        aymurai_label_subclass: null,
        aymurai_alt_text: null,
        aymurai_alt_start_char: 10,
        aymurai_alt_end_char: 19,
      },
    });
    const stored = makeLabel();

    expect(comparePrediction(rendered, stored)).toBe(false);
  });
});
