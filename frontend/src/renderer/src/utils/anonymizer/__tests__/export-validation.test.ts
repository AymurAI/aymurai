import { describe, expect, it } from "vitest";
import type { PredictLabel } from "@/types/aymurai";
import type { DocFile } from "@/types/file";
import {
  AnonymizerExportValidationError,
  assertValidAnonymizerExportState,
} from "../export-validation";

function makeFile(paragraphValue: string): DocFile {
  return {
    data: { name: "documento.pdf" },
    paragraphs: [{ id: "p1", value: paragraphValue }],
  } as unknown as DocFile;
}

function makeLabel(
  start: number,
  end: number,
  text: string,
  overrides: Partial<PredictLabel> = {},
): PredictLabel {
  return {
    mentionId: `m:${start}:${end}`,
    text,
    start_char: start,
    end_char: end,
    paragraphId: "p1",
    attrs: {
      aymurai_label: "PER",
      aymurai_label_subclass: null,
      aymurai_alt_text: null,
      aymurai_alt_start_char: start,
      aymurai_alt_end_char: end,
      canonical_entity_id: "3d0683b6-6b48-4d5e-8f0a-111111111111",
    },
    ...overrides,
  } as PredictLabel;
}

describe("assertValidAnonymizerExportState", () => {
  it("does not throw for a valid state", () => {
    const file = makeFile("Ana Perez presento el escrito");
    const labels = [makeLabel(0, 9, "Ana Perez")];

    expect(() => assertValidAnonymizerExportState(file, labels)).not.toThrow();
  });

  it("names the offending entities in the error message", () => {
    const file = makeFile("Ana Perez presento el escrito");
    const labels = [
      makeLabel(0, 9, "Ana Perez"),
      makeLabel(4, 14, "Perez pres"),
    ];

    let thrown: unknown;
    try {
      assertValidAnonymizerExportState(file, labels);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AnonymizerExportValidationError);
    const message = (thrown as AnonymizerExportValidationError).message;
    // The user must be able to locate the broken entity from the toast alone.
    expect(message).toContain("Perez pres");
    expect(message).toContain("PER");
  });

  it("caps the enumeration for large issue lists", () => {
    const file = makeFile("abcdefghijklmnopqrstuvwxyz");
    const labels = Array.from({ length: 6 }, (_, index) =>
      makeLabel(index, index + 5, `wrong-${index}`),
    );

    let thrown: unknown;
    try {
      assertValidAnonymizerExportState(file, labels);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AnonymizerExportValidationError);
    const message = (thrown as AnonymizerExportValidationError).message;
    expect(message).toMatch(/\+\d+ más/);
  });
});
