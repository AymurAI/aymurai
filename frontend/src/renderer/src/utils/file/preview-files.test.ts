import { describe, expect, it } from "vitest";

import { FeatureFlowEnum } from "@/types/features";
import { filesForFeatureLoad } from "./preview-files";

const file = (name: string) => new File(["x"], name);

describe("filesForFeatureLoad", () => {
  it("keeps only the last file for the anonymizer, which is single-document", () => {
    const files = [file("a.docx"), file("b.docx"), file("c.docx")];

    expect(filesForFeatureLoad(FeatureFlowEnum.Anonymizer, files)).toEqual([
      files[2],
    ]);
  });

  it("keeps every file for the batch features", () => {
    const files = [file("a.docx"), file("b.docx")];

    for (const feature of [
      FeatureFlowEnum.Dataset,
      FeatureFlowEnum.VoiceToText,
      FeatureFlowEnum.Summarizer,
    ]) {
      expect(filesForFeatureLoad(feature, files)).toEqual(files);
    }
  });

  it("keeps a single document for recommendations", () => {
    const files = [file("a.pdf"), file("b.pdf")];

    expect(filesForFeatureLoad(FeatureFlowEnum.Recommendations, files)).toEqual(
      [files[1]],
    );
  });
});
