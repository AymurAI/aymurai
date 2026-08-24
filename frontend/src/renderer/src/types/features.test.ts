import { describe, expect, it } from "vitest";

import {
  FeatureFlowEnum,
  featureRouteSlug,
  getFeatureRouteSlug,
  parseFeatureRouteSlug,
} from "./features";

describe("feature route slugs", () => {
  it("maps every enum member to a URL-safe lowercase slug", () => {
    expect(featureRouteSlug).toEqual({
      [FeatureFlowEnum.Dataset]: "dataset",
      [FeatureFlowEnum.Anonymizer]: "anonymizer",
      [FeatureFlowEnum.VoiceToText]: "voice-to-text",
      [FeatureFlowEnum.Summarizer]: "summarizer",
    });
  });

  it("round-trips every feature", () => {
    for (const feature of Object.values(FeatureFlowEnum)) {
      expect(parseFeatureRouteSlug(getFeatureRouteSlug(feature))).toBe(feature);
    }
  });

  it("accepts a slug in any case", () => {
    expect(parseFeatureRouteSlug("DATASET")).toBe(FeatureFlowEnum.Dataset);
    expect(parseFeatureRouteSlug("Voice-To-Text")).toBe(
      FeatureFlowEnum.VoiceToText,
    );
  });

  // The server 307s these to the canonical slug, so the SPA should never see
  // them. Returning null (not a throw) keeps the layout route's redirect path
  // the only failure handler.
  it("rejects the legacy enum and interim slugs", () => {
    expect(parseFeatureRouteSlug("DATA_SET")).toBeNull();
    expect(parseFeatureRouteSlug("data_set")).toBeNull();
    expect(parseFeatureRouteSlug("nope")).toBeNull();
  });
});
