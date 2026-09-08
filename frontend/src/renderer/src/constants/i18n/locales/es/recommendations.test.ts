import { describe, expect, it } from "vitest";
import recommendations from "./recommendations";

describe("recommendations i18n — onboarding", () => {
  it("defines every onboarding key the shared DocumentOnboarding screen reads", () => {
    expect(recommendations.onboarding).toBeDefined();
    expect(recommendations.onboarding.sectionTitle).toBe("1. Selección de archivo");
    expect(recommendations.onboarding.loadDocuments).toBe("Cargar documento");
    expect(typeof recommendations.onboarding.dropAreaTitle).toBe("string");
    expect(typeof recommendations.onboarding.dropAreaFormats).toBe("string");
    expect(typeof recommendations.onboarding.validFormats).toBe("string");
  });
});
